/**
 * POST /api/proposals/[uuid]/confirm
 *
 * Called by the client AFTER the on-chain `utility.batchAll` finalises.
 * The client extracts the referendum_index from the `Referenda.Submitted`
 * event and posts it here so we can:
 *
 *   1. Verify on chain that this referendum really is bound to THIS row's
 *      envelope (see `metadataBindingMatches`).
 *   2. Flip the DB row status → 'on_chain' and lock in the on-chain coords.
 *   3. Write a tiny redirect file at `proposals/{network}/index/{index}.json`
 *      so an external indexer that only has the referendum index can
 *      resolve back to the canonical proposal.json without our database.
 */

import { NextResponse, type NextRequest } from "next/server"
import { blake2AsHex } from "@polkadot/util-crypto"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { getApi } from "@/lib/chain/api"
import { CHAINS, type ChainId } from "@/lib/chain/chains"
import { initializeWasm, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import {
  attachReferendumIndex,
  getProposalById,
  replaceAttachments,
  updateProposalDraft,
} from "@/lib/db/proposals"
import { listVersionKeys, versionWithMetadataHash } from "@/lib/governance/draft-versions"
import {
  buildRemarkPayload,
  expectedMetadataHash,
  type ProposalJson,
} from "@/lib/governance/proposal-metadata"
import { getReferendum, getReferendumHistory } from "@/lib/governance/referenda"
import type { OngoingStatus } from "@/lib/governance/types"
import { flagText } from "@/lib/moderation/auto-flag"
import { postingSuspendedResponse } from "@/lib/moderation/suspension"
import { isR2Configured } from "@/lib/r2/client"
import { keyFromPublicUrl, ownMediaKey, proposalIndexRedirectKey } from "@/lib/r2/paths"
import { putJson } from "@/lib/r2/upload"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export const runtime = "nodejs"

/**
 * The chain read is bounded to CHAIN_READ_DEADLINE_MS below; this is the
 * outer backstop so the route always answers with its own status code
 * rather than being cut off by the platform's default function timeout.
 */
// The chain read takes up to 8 s; the rest is room for the background text
// check (next/server `after`) that runs once the proposal is public.
export const maxDuration = 60

type BindingCheck =
  | { ok: true }
  | {
      ok: false
      status: 409 | 503
      error: string
      retryable: boolean
      /** The hash the referendum is bound to, when it isn't this version's. */
      onChain?: string
    }

/**
 * Hard ceiling on the whole chain read. `getApi` already bounds its own
 * connect (10s) and ready (15s) waits, but the query that follows has no
 * timeout at all, so a socket that opens against a wedged node would hang
 * the request until the platform kills it. One deadline covers both.
 */
const CHAIN_READ_DEADLINE_MS = 8_000

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`chain read exceeded ${ms}ms`)), ms).unref?.(),
    ),
  ])
}

/**
 * Confirm that `referenda.metadataOf(index)` on chain is the blake2-256 of
 * THIS row's EGOV1 envelope, rebuilt deterministically from its own
 * `json_url` + `json_sha256`.
 *
 * Without this the endpoint is trust-the-client: the body's tx/block hashes
 * are only shape-checked, so any signed-in user could attach any unclaimed
 * referendum index to their own draft and have us render their narrative on
 * someone else's referendum. Worse, `proposals_network_index_unique` then
 * locks the real proposer out permanently.
 *
 * Fails CLOSED, unlike the edit path's `referendumConcluded` which fails
 * open. The polarity differs on purpose: there, a transient RPC error at
 * worst allows an edit that the on-chain hash divergence still exposes;
 * here, proceeding on an unverified claim IS the vulnerability.
 *
 * Failing closed is only safe because the caller retries: the row stays
 * 'draft' until one succeeds, and the on-chain binding it re-reads is
 * durable. `retryable` tells the caller which failures are worth another
 * attempt - a 503 or a not-yet-anchored referendum will clear on their own,
 * a hash mismatch never will.
 */
async function metadataBindingMatches(
  network: string,
  index: number,
  jsonUrl: string,
  jsonSha256: string,
): Promise<BindingCheck> {
  const chain = CHAINS[network as ChainId]
  if (!chain) {
    return { ok: false, status: 409, error: `Unknown network ${network}`, retryable: false }
  }

  const expected = expectedMetadataHash(jsonUrl, jsonSha256)

  let onChain: string | null
  try {
    // retries = 0: the caller retries the whole request, so a retry loop
    // here only stacks 25s attempts inside a request that must answer fast.
    onChain = await withDeadline(
      (async () => {
        const api = await getApi(chain.rpc, 0)
        const raw = await api.query.referenda.metadataOf(index)
        const opt = raw as unknown as {
          isSome: boolean
          unwrap: () => { toHex: () => string }
        }
        return opt.isSome ? opt.unwrap().toHex() : null
      })(),
      CHAIN_READ_DEADLINE_MS,
    )
  } catch {
    return {
      ok: false,
      status: 503,
      error:
        "Could not reach the chain to verify the metadata binding. The on-chain state is durable - retry shortly.",
      retryable: true,
    }
  }

  if (onChain == null) {
    // Retryable on purpose: the client confirms on finalization, but a node
    // that is briefly behind can still answer None for a setMetadata that
    // did land. Only a mismatch below is a permanent verdict.
    return {
      ok: false,
      status: 409,
      error: `Referendum ${index} has no metadata set on chain. Anchor setMetadata before confirming.`,
      retryable: true,
    }
  }
  if (onChain.toLowerCase() !== expected.toLowerCase()) {
    return {
      ok: false,
      status: 409,
      error: `Referendum ${index} is bound to a different envelope (${onChain}); this proposal's is ${expected}.`,
      retryable: false,
      onChain,
    }
  }
  return { ok: true }
}

/**
 * The metadata binding alone doesn't prove the referendum is this draft's:
 * anyone can note a copy of a draft's envelope and set it as the metadata
 * of their own referendum. So the referendum must also have been filed
 * (submission deposit) by this draft's proposer and, while it is ongoing,
 * enact exactly the draft's call.
 */
async function filedByProposer(
  network: string,
  index: number,
  row: { proposer_address: string; preimage_hash: string | null; preimage_len: number | null },
): Promise<BindingCheck> {
  const chain = CHAINS[network as ChainId]
  if (!chain) {
    return { ok: false, status: 409, error: `Unknown network ${network}`, retryable: false }
  }
  let ongoing: OngoingStatus | null = null
  let deposit: { who: string } | null = null
  // The archive read failed (or found nothing): a later try may still work.
  let historyUnread = false
  try {
    await withDeadline(
      (async () => {
        const ref = await getReferendum(await getApi(chain.rpc, 0), index)
        const status = ref?.status
        if (status?.type === "Ongoing") ongoing = status
        deposit = status && status.type !== "Killed" ? status.submissionDeposit : null
        // A concluded referendum no longer carries its call, and a refunded
        // or killed one no longer its depositor: its last ongoing state on
        // an archive node still has both.
        if (status && status.type !== "Ongoing" && (!deposit || !ongoing) && chain.archiveRpc) {
          const past = await getReferendumHistory(
            await getApi(chain.archiveRpc, 0),
            index,
            status.at,
          )
          if (past?.status.type === "Ongoing") {
            ongoing = past.status
            deposit = deposit ?? past.status.submissionDeposit
          } else if (!past) {
            historyUnread = true
          }
        }
      })(),
      CHAIN_READ_DEADLINE_MS,
    )
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Could not reach the chain to check who filed this referendum - retry shortly.",
      retryable: true,
    }
  }
  const filer = deposit as { who: string } | null
  if (!filer && historyUnread) {
    return {
      ok: false,
      status: 503,
      error: `Could not read who filed referendum ${index} - retry shortly.`,
      retryable: true,
    }
  }
  if (!filer) {
    return {
      ok: false,
      status: 409,
      error: `Can't tell who filed referendum ${index}, so it can't be linked here.`,
      retryable: false,
    }
  }
  let sameFiler = false
  try {
    sameFiler = samePublicKey(filer.who, row.proposer_address)
  } catch {
    sameFiler = false
  }
  if (!sameFiler) {
    return {
      ok: false,
      status: 409,
      error: `Referendum ${index} was filed by another account.`,
      retryable: false,
    }
  }
  const call = ongoing as OngoingStatus | null
  if (call && row.preimage_hash) {
    const p = call.proposal
    const [hash, len] =
      "type" in p && p.type === "Inline"
        ? [blake2AsHex(p.bytes, 256), p.bytes.length]
        : [(p as { hash: string }).hash, (p as { len: number }).len]
    if (
      hash.toLowerCase() !== row.preimage_hash.toLowerCase() ||
      (row.preimage_len != null && len !== row.preimage_len)
    ) {
      return {
        ok: false,
        status: 409,
        error: `Referendum ${index} enacts a different call than this proposal.`,
        retryable: false,
      }
    }
  }
  return { ok: true }
}

const uuidSchema = z.string().uuid()

// The tx coordinates are optional: a proposer whose submission landed but
// never got linked can link it later by index alone. The on-chain binding
// check below is what proves ownership either way.
const bodySchema = z.object({
  referendum_index: z.number().int().nonnegative(),
  tx_hash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable()
    .optional(),
  block_hash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable()
    .optional(),
  block_number: z.number().int().nonnegative().nullable().optional(),
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ uuid: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Database is not configured" }, { status: 503 })
  }

  const { uuid: rawUuid } = await context.params
  const uuidParse = uuidSchema.safeParse(rawUuid)
  if (!uuidParse.success) {
    return NextResponse.json({ ok: false, error: "Invalid proposal uuid" }, { status: 400 })
  }
  const proposalUuid = uuidParse.data

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    )
  }

  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to confirm a proposal." },
      { status: 401 },
    )
  }
  // Linking publishes the draft, so a paused account can't do it either.
  const suspended = await postingSuspendedResponse(me)
  if (suspended) return suspended

  // Every call below reads the chain; cap them per account.
  const rl = await enforceRateLimit({ ...RATE_LIMITS.proposalConfirm, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "Too many attempts to link this proposal - wait a few minutes and try again.",
        retryable: false,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  const existing = await getProposalById(proposalUuid)
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Proposal not found" }, { status: 404 })
  }

  await initializeWasm()
  if (!samePublicKey(existing.proposer_address, me.address)) {
    return NextResponse.json(
      { ok: false, error: "Only the proposer can confirm this proposal." },
      { status: 403 },
    )
  }

  // Cheap auth checks first, then the chain read: the client's tx/block
  // hashes are only shape-validated, so the on-chain binding is the only
  // thing that actually proves this row owns this referendum index.
  let binding = await metadataBindingMatches(
    existing.network,
    parsed.referendum_index,
    existing.json_url,
    existing.json_sha256,
  )
  // The batch may have been signed from an older staged version (another
  // tab, or a re-stage while it was in flight): find that version.
  let signed: { key: string; url: string; sha256: string; json: ProposalJson } | null = null
  if (!binding.ok && binding.onChain && existing.status === "draft" && isR2Configured()) {
    try {
      const v = await versionWithMetadataHash(
        existing,
        await listVersionKeys(existing),
        binding.onChain,
      )
      if (v) {
        signed = { ...v, json: JSON.parse(v.text) as ProposalJson }
        binding = { ok: true }
      }
    } catch {
      // keep the mismatch
    }
  }
  if (!binding.ok) {
    return NextResponse.json(
      { ok: false, error: binding.error, retryable: binding.retryable },
      { status: binding.status },
    )
  }
  const filer = await filedByProposer(
    existing.network,
    parsed.referendum_index,
    signed
      ? {
          proposer_address: existing.proposer_address,
          preimage_hash: signed.json.preimage_hash ?? null,
          preimage_len: signed.json.preimage_len ?? null,
        }
      : existing,
  )
  if (!filer.ok) {
    return NextResponse.json(
      { ok: false, error: filer.error, retryable: filer.retryable },
      { status: filer.status },
    )
  }

  if (signed) {
    // The draft becomes the version that was signed, so the page shows
    // exactly what the referendum pins.
    const j = signed.json
    const reverted = await updateProposalDraft({
      id: existing.id,
      expectedSha256: existing.json_sha256,
      title: j.title,
      summary: j.summary ?? null,
      bodyMarkdown: j.body_markdown,
      track: j.track ?? null,
      beneficiary: j.spend?.beneficiary ?? null,
      amountPlanck: j.spend?.amount_planck ? BigInt(j.spend.amount_planck) : null,
      jsonUrl: signed.url,
      jsonKey: signed.key,
      jsonSha256: signed.sha256,
      preimageHash: j.preimage_hash ?? null,
      preimageLen: j.preimage_len ?? null,
      remarkPayload: buildRemarkPayload(signed.url, signed.sha256),
    }).catch(() => null)
    if (!reverted) {
      return NextResponse.json(
        { ok: false, error: "The draft changed while linking - try again.", retryable: true },
        { status: 409 },
      )
    }
    const attachments = (j.attachments ?? []).flatMap((a) => {
      const key = ownMediaKey(keyFromPublicUrl(a.url), existing.network, existing.id)
      return key
        ? [
            {
              bucketKey: key,
              url: a.url,
              filename: a.name,
              contentType: a.content_type,
              sizeBytes: a.size_bytes,
              sha256: a.sha256,
              uploadedBy: null,
            },
          ]
        : []
    })
    await replaceAttachments(existing.id, attachments).catch(() => undefined)
  }

  let row
  try {
    row = await attachReferendumIndex({
      proposalId: proposalUuid,
      referendumIndex: parsed.referendum_index,
      txHash: parsed.tx_hash ?? null,
      blockHash: parsed.block_hash ?? null,
      blockNumber: parsed.block_number ?? null,
    })
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e)
    console.error("[proposals/confirm] db update failed", cause)
    return NextResponse.json(
      {
        ok: false,
        error: "Database error - the proposal was not linked. Try again.",
        retryable: true,
      },
      { status: 502 },
    )
  }

  // Best-effort redirect blob - failure here is non-fatal; the DB row
  // still carries the index → json_url mapping.
  let redirectUrl: string | null = null
  if (isR2Configured()) {
    try {
      const redirectKey = proposalIndexRedirectKey(
        // The network values map 1:1 between R2 paths and the chain registry.
        row.network as "enjin-relay" | "enjin-matrix" | "canary-relay" | "canary-matrix",
        parsed.referendum_index,
      )
      const put = await putJson(redirectKey, {
        proposal_id: row.id,
        json_url: row.json_url,
        json_sha256: row.json_sha256,
        referendum_index: parsed.referendum_index,
        tx_hash: parsed.tx_hash ?? null,
        block_hash: parsed.block_hash ?? null,
        block_number: parsed.block_number ?? null,
      })
      redirectUrl = put.url
    } catch {
      // ignore
    }
  }

  // The proposal is public now: check its text in the background (flags
  // for a moderator at most, never hides it).
  flagText({
    targetType: "proposal",
    targetId: row.id,
    proposalId: row.id,
    text: [row.title, row.summary ?? "", row.body_markdown].join("\n\n"),
  })

  return NextResponse.json({
    ok: true,
    id: row.id,
    referendum_index: row.referendum_index,
    json_url: row.json_url,
    redirect_url: redirectUrl,
    status: row.status,
  })
}

/**
 * POST /api/proposals/draft
 *
 * Pre-signature staging step. Uploads the canonical proposal.json to R2,
 * inserts a row in the proposals table with status='draft', and inserts
 * attachment rows referencing media that was uploaded earlier via
 * /api/proposals/[id]/media.
 *
 * Returns:
 *   {
 *     id,                  // UUID, same as the R2 key prefix
 *     json_url,            // public R2 URL of proposal.json
 *     json_sha256,         // sha256 of canonical JSON bytes
 *     remark_payload,      // exact EGOV1 envelope string anchored on chain
 *     proposal             // the proposal.json contents (for preview)
 *   }
 *
 * Auth: requires a signed-in session, and the supplied proposer_address
 * must be the session's own wallet (matched by public key). A draft row
 * is still not cryptographic proof of authorship - the JSON's optional
 * `signature` field isn't verified - but it can no longer be filed
 * anonymously or under someone else's address.
 *
 * An existing id is checked before anything is written to R2: only its own
 * proposer may re-stage it, only while it is still an unsigned draft whose
 * envelope hasn't reached the chain, and only from the version the browser
 * last saw (`expected_sha256`). Every attachment key must sit in the
 * proposal's own media folder.
 */

import { createHash } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { initializeWasm, isValidAddressForChain, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import {
  getProposalById,
  insertProposalDraft,
  insertAttachment,
  replaceAttachments,
  updateProposalDraft,
  type CreateProposalDraft,
} from "@/lib/db/proposals"
import { checkAttachments, listedAttachments } from "@/lib/governance/attachment-check"
import { anyVersionOnChain, listVersionKeys } from "@/lib/governance/draft-versions"
import { upsertUserByAddress } from "@/lib/db/users"
import { isR2Configured, publicAssetBase } from "@/lib/r2/client"
import { stringifyStable } from "@/lib/r2/json"
import { ownMediaKey, proposalJsonVersionKey, publicUrlFor } from "@/lib/r2/paths"
import { putJson, readObjectText } from "@/lib/r2/upload"
import { postingSuspendedResponse } from "@/lib/moderation/suspension"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  buildRemarkPayload,
  PROPOSAL_SCHEMA,
  PROPOSAL_SCHEMA_VERSION,
  PROPOSAL_SCHEMA_VERSION_WITH_CALL,
  type ProposalAttachmentMeta,
  type ProposalJson,
} from "@/lib/governance/proposal-metadata"

export const runtime = "nodejs"

const NETWORK_VALUES = [
  "enjin-relay",
  "enjin-matrix",
  "canary-relay",
  "canary-matrix",
] as const

const attachmentSchema = z.object({
  bucket_key: z.string().min(1),
  name: z.string().min(1).max(255),
  url: z.string().url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  content_type: z.string().min(1).max(120),
  size_bytes: z.number().int().positive(),
})

const bodySchema = z.object({
  proposal_id: z.string().uuid(),
  network: z.enum(NETWORK_VALUES),
  proposer_address: z.string().min(1),
  title: z.string().min(1).max(200),
  summary: z.string().max(500).nullable(),
  body_markdown: z.string().max(100_000),
  track: z.string().max(80).nullable(),
  beneficiary: z.string().min(1).nullable(),
  amount_planck: z
    .string()
    .regex(/^[0-9]+$/)
    .nullable(),
  preimage_hash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  preimage_len: z.number().int().nonnegative().nullable(),
  attachments: z.array(attachmentSchema).max(20).default([]),
  /** EGOV1 1.2.0: the call being proposed (advanced composer). */
  call: z
    .object({
      section: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
      method: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
      origin: z.string().min(1).max(80),
      preimage_hash: z.string().regex(/^0x[0-9a-f]{64}$/),
      preimage_len: z.number().int().positive(),
      inline: z.boolean(),
      code_hash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable().optional(),
    })
    .strict()
    .nullable()
    .optional(),
  /** EGOV1 1.2.0: the enactment moment chosen at submission. */
  enactment: z
    .object({
      type: z.enum(["At", "After"]),
      block: z.number().int().nonnegative(),
    })
    .strict()
    .nullable()
    .optional(),
  /**
   * When re-staging an existing draft: the json_sha256 the browser last saw.
   * The update only applies if the row still has it.
   */
  expected_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isR2Configured()) {
    return NextResponse.json(
      { ok: false, error: "Storage is not configured (set R2_* env vars)" },
      { status: 503 },
    )
  }
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured (set DATABASE_URL)" },
      { status: 503 },
    )
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid body"
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }

  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to stage a proposal." },
      { status: 401 },
    )
  }
  const suspended = await postingSuspendedResponse(me)
  if (suspended) return suspended

  const rl = await enforceRateLimit({ ...RATE_LIMITS.proposalDraft, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many draft submissions - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  // A draft can't be filed for someone else's wallet - the proposer
  // address baked into proposal.json must be the signed-in session's own
  // key. Compare by public-key bytes so a cross-prefix session still matches.
  await initializeWasm()
  if (!samePublicKey(parsed.proposer_address, me.address)) {
    return NextResponse.json(
      { ok: false, error: "You can only file a proposal for your own wallet." },
      { status: 403 },
    )
  }

  // The payout address must already be in this network's own format - the
  // browser asks before converting, and the server doesn't convert either.
  if (
    parsed.beneficiary != null &&
    !isValidAddressForChain(parsed.beneficiary, parsed.network)
  ) {
    return NextResponse.json(
      { ok: false, error: "Beneficiary must be a valid address for this network." },
      { status: 400 },
    )
  }

  // proposal_id is client-minted, and the JSON key is derived from it - so
  // it must be checked BEFORE anything is written. An id that already has a
  // row is someone's existing proposal (or this user's own, already-saved
  // draft); writing to its key would replace that proposal's stored JSON
  // even though the insert below then fails on the primary key.
  let existingRow
  try {
    existingRow = await getProposalById(parsed.proposal_id)
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not check the proposal id - try again." },
      { status: 503 },
    )
  }
  // An existing id may only be re-staged by its own proposer, while it is
  // still an unsigned draft on the same network, and only from the version
  // the browser last saw (two tabs can't silently overwrite each other).
  if (existingRow) {
    if (!samePublicKey(existingRow.proposer_address, me.address)) {
      return NextResponse.json(
        { ok: false, error: "This proposal id is already in use." },
        { status: 403 },
      )
    }
    if (existingRow.status !== "draft" || existingRow.network !== parsed.network) {
      return NextResponse.json(
        { ok: false, error: "This proposal can no longer be changed here." },
        { status: 409 },
      )
    }
    if (parsed.expected_sha256 !== existingRow.json_sha256) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This draft was changed elsewhere. Reload the page and resume it from your drafts.",
        },
        { status: 409 },
      )
    }
    // Once a batch signed from any stored version landed, the draft must
    // be linked to its referendum, not staged again. Fails closed: if the
    // folder or the chain can't be read, don't write.
    let anchored: boolean
    try {
      anchored = await anyVersionOnChain(existingRow, await listVersionKeys(existingRow))
    } catch {
      return NextResponse.json(
        { ok: false, error: "Could not reach the chain to check this draft - try again." },
        { status: 503 },
      )
    }
    if (anchored) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This draft already reached the chain. Link it to its referendum from your drafts instead.",
        },
        { status: 409 },
      )
    }
  }

  // Attachment keys come from the browser and are later deleted from the
  // bucket together with the draft, so each one must live in this
  // proposal's own media folder. The URL written into the JSON is built from
  // that key, never taken from the browser, so a proposal can only ever
  // point at its own files.
  const claimed: { key: string; att: (typeof parsed.attachments)[number] }[] = []
  for (const att of parsed.attachments) {
    const ownKey = ownMediaKey(att.bucket_key, parsed.network, parsed.proposal_id)
    if (!ownKey) {
      return NextResponse.json(
        { ok: false, error: `Attachment "${att.name}" doesn't belong to this proposal.` },
        { status: 400 },
      )
    }
    claimed.push({ key: ownKey, att: { ...att, url: publicUrlFor(publicAssetBase(), ownKey) } })
  }

  // Size, type and hash must be the stored file's own, not just what the
  // browser says. Compared with the version being replaced, so a file
  // removed since it was saved can stay listed.
  let savedJson: string | null = null
  if (existingRow) {
    try {
      savedJson = await readObjectText(existingRow.json_key)
    } catch {
      return NextResponse.json(
        { ok: false, error: "Could not check the attachments - try again." },
        { status: 503 },
      )
    }
  }
  const checked = await checkAttachments(
    claimed.map(({ key, att }) => ({
      key,
      name: att.name,
      sha256: att.sha256,
      content_type: att.content_type,
      size_bytes: att.size_bytes,
    })),
    listedAttachments(savedJson),
  )
  if (!checked.ok) {
    return NextResponse.json({ ok: false, error: checked.error }, { status: checked.status })
  }
  const attachments = claimed.map(({ key, att }, i) => ({
    key,
    att: { ...att, name: checked.attachments[i]!.name },
  }))

  // The call section describes what the referendum enacts, so it must agree
  // with the preimage the draft records.
  if (
    parsed.call &&
    (parsed.call.preimage_hash !== parsed.preimage_hash ||
      parsed.call.preimage_len !== parsed.preimage_len)
  ) {
    return NextResponse.json(
      { ok: false, error: "The call section doesn't match the proposal's preimage." },
      { status: 400 },
    )
  }
  const withCall = parsed.call != null || parsed.enactment != null

  const proposalJson: ProposalJson = {
    schema: PROPOSAL_SCHEMA,
    version: withCall ? PROPOSAL_SCHEMA_VERSION_WITH_CALL : PROPOSAL_SCHEMA_VERSION,
    network: parsed.network,
    proposer: parsed.proposer_address,
    title: parsed.title,
    summary: parsed.summary,
    body_markdown: parsed.body_markdown,
    track: parsed.track,
    spend:
      parsed.beneficiary && parsed.amount_planck
        ? {
            beneficiary: parsed.beneficiary,
            amount_planck: parsed.amount_planck,
          }
        : null,
    attachments: attachments.map(
      ({ att: a }): ProposalAttachmentMeta => ({
        name: a.name,
        url: a.url,
        sha256: a.sha256,
        content_type: a.content_type,
        size_bytes: a.size_bytes,
      }),
    ),
    ...(withCall ? { call: parsed.call ?? null, enactment: parsed.enactment ?? null } : {}),
    preimage_hash: parsed.preimage_hash,
    preimage_len: parsed.preimage_len,
    created_at: (existingRow?.created_at ?? new Date()).toISOString(),
    signature: null,
  }

  // Each staged version is stored under its own hash-named key and never
  // overwritten: a batch signed from an earlier version (still in flight,
  // or from another tab) keeps pointing at exactly the bytes it pinned.
  const jsonText = stringifyStable(proposalJson)
  const jsonSha256 = createHash("sha256").update(jsonText, "utf8").digest("hex")
  if (existingRow && existingRow.json_sha256 === jsonSha256 && existingRow.remark_payload) {
    // Nothing changed since the saved version - no write needed.
    return NextResponse.json({
      ok: true,
      id: existingRow.id,
      updated: false,
      json_url: existingRow.json_url,
      json_sha256: existingRow.json_sha256,
      json_size_bytes: Buffer.byteLength(jsonText, "utf8"),
      remark_payload: existingRow.remark_payload,
      proposal: proposalJson,
    })
  }
  const key = proposalJsonVersionKey(parsed.network, parsed.proposal_id, jsonSha256)

  let put
  try {
    put = await putJson(key, proposalJson)
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `R2 upload failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    )
  }

  const remarkPayload = buildRemarkPayload(put.url, put.sha256)

  let proposerUserId: string | null = null
  try {
    const user = await upsertUserByAddress(parsed.proposer_address)
    proposerUserId = user.id
  } catch {
    // Best-effort - proceed without a user row.
  }

  const draft: CreateProposalDraft = {
    id: parsed.proposal_id,
    network: parsed.network,
    proposerUserId,
    proposerAddress: parsed.proposer_address,
    title: parsed.title,
    summary: parsed.summary,
    bodyMarkdown: parsed.body_markdown,
    track: parsed.track,
    beneficiary: parsed.beneficiary,
    amountPlanck: parsed.amount_planck ? BigInt(parsed.amount_planck) : null,
    jsonUrl: put.url,
    jsonKey: put.key,
    jsonSha256: put.sha256,
    proposerSignature: null,
    preimageHash: parsed.preimage_hash,
    preimageLen: parsed.preimage_len,
    remarkPayload,
  }

  if (existingRow) {
    let updated
    try {
      updated = await updateProposalDraft({
        id: existingRow.id,
        // The version this request was checked against, above.
        expectedSha256: existingRow.json_sha256,
        title: draft.title,
        summary: draft.summary,
        bodyMarkdown: draft.bodyMarkdown,
        track: draft.track,
        beneficiary: draft.beneficiary,
        amountPlanck: draft.amountPlanck,
        jsonUrl: draft.jsonUrl,
        jsonKey: draft.jsonKey,
        jsonSha256: draft.jsonSha256,
        preimageHash: draft.preimageHash,
        preimageLen: draft.preimageLen,
        remarkPayload: draft.remarkPayload,
      })
    } catch {
      return NextResponse.json(
        { ok: false, error: "Could not save the draft - try again." },
        { status: 503 },
      )
    }
    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This draft was changed elsewhere. Reload the page and resume it from your drafts.",
        },
        { status: 409 },
      )
    }
    // Files this version no longer lists stay in storage: an earlier
    // version that may already be pinned on chain can still reference them.
    // Deleting the draft removes its whole folder.
    try {
      await replaceAttachments(
        updated.id,
        attachments.map(({ key: bucketKey, att }) => ({
          bucketKey,
          url: att.url,
          filename: att.name,
          contentType: att.content_type,
          sizeBytes: att.size_bytes,
          sha256: att.sha256,
          uploadedBy: proposerUserId,
        })),
      )
    } catch {
      // Best-effort - the JSON already carries the authoritative list.
    }
    return NextResponse.json({
      ok: true,
      id: updated.id,
      updated: true,
      json_url: put.url,
      json_sha256: put.sha256,
      json_size_bytes: put.sizeBytes,
      remark_payload: remarkPayload,
      proposal: proposalJson,
    })
  }

  let row
  try {
    row = await insertProposalDraft(draft)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    // The most common cause of this branch in a fresh deploy is that the
    // migration hasn't been applied yet. Surface a nudge instead of the
    // raw Postgres error so the demo doesn't show "relation does not
    // exist" to the user.
    if (/relation .* does not exist/i.test(raw)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Database tables are missing. Apply scripts/004_proposals_comments_profiles.sql to the Neon project (run `pnpm db:migrate` locally, or paste the SQL into the Neon SQL editor).",
        },
        { status: 503 },
      )
    }
    if (/duplicate key/i.test(raw)) {
      return NextResponse.json(
        {
          ok: false,
          error: "This draft is already saved. Reload the page and resume it from your drafts.",
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { ok: false, error: `Db insert failed: ${raw}` },
      { status: 502 },
    )
  }

  for (const { key: bucketKey, att } of attachments) {
    try {
      await insertAttachment({
        proposalId: row.id,
        bucketKey,
        url: att.url,
        filename: att.name,
        contentType: att.content_type,
        sizeBytes: att.size_bytes,
        sha256: att.sha256,
        uploadedBy: proposerUserId,
      })
    } catch {
      // Don't fail the proposal if a single attachment row collides - the
      // JSON already carries the attachment metadata authoritatively.
    }
  }

  return NextResponse.json({
    ok: true,
    id: row.id,
    json_url: put.url,
    json_sha256: put.sha256,
    json_size_bytes: put.sizeBytes,
    remark_payload: remarkPayload,
    proposal: proposalJson,
  })
}

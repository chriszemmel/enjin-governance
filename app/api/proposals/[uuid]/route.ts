/**
 * DELETE /api/proposals/[uuid]
 *
 * Hard-deletes a proposal row from the database. Refused for proposals
 * that already reached `on_chain` - cancelling client-side wouldn't undo
 * the referendum, so we don't pretend it can. Drafts, cancelled rows,
 * failed rows, and broadcast-but-never-finalised rows can all be
 * removed.
 *
 * The proposal's R2 objects (proposal.json + attachments) are deleted too,
 * best-effort, so a discarded draft doesn't leave blobs behind. Only
 * deletable rows reach here (never an on-chain proposal whose URL a finalised
 * envelope pins), so this can't 404 a shared on-chain link.
 *
 * PATCH /api/proposals/[uuid]
 *
 * Proposer-only edit to the off-chain narrative (title, summary, body,
 * attachments). Re-uploads the canonical proposal.json at the SAME R2
 * key, so existing URLs keep resolving - but the sha256 changes, so
 * the on-chain envelope's pinned hash will no longer match the bucket
 * bytes. That divergence is the visible signal that an edit happened.
 *
 * The pre-image, spend amount, beneficiary, and submitter address are
 * deliberately NOT editable - those are baked into the on-chain
 * referendum and can't be changed without filing a new proposal.
 */

import { createHash } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { isDbConfigured } from "@/lib/db/client"
import {
  deleteProposalById,
  getProposalById,
  listAttachments,
  replaceAttachments,
  updateProposalContent,
  type ReplaceAttachmentItem,
} from "@/lib/db/proposals"
import { isR2Configured, publicAssetBase } from "@/lib/r2/client"
import { isProposalJsonKey, ownMediaKey, proposalPrefix, publicUrlFor } from "@/lib/r2/paths"
import { thumbKeyFor } from "@/lib/governance/proposal-media"
import { flagText } from "@/lib/moderation/auto-flag"
import { postingSuspendedResponse } from "@/lib/moderation/suspension"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { deleteObjects, listObjectKeys, putJson, readObjectText } from "@/lib/r2/upload"
import { isEnvelopeOnChain } from "@/lib/governance/envelope-status"
import { initializeWasm, samePublicKey } from "@/lib/chain/ss58"
import { CHAINS, type ChainId } from "@/lib/chain/chains"
import { getApi } from "@/lib/chain/api"
import { getReferendum } from "@/lib/governance/referenda"
import {
  PROPOSAL_SCHEMA,
  PROPOSAL_SCHEMA_VERSION,
  PROPOSAL_SCHEMA_VERSION_WITH_CALL,
  type ProposalAttachmentMeta,
  type ProposalJson,
} from "@/lib/governance/proposal-metadata"

export const runtime = "nodejs"
// Leaves time for the background text check after an edit.
export const maxDuration = 60

const uuidSchema = z.string().uuid()

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ uuid: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }

  const { uuid: raw } = await context.params
  const parsed = uuidSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid proposal uuid" },
      { status: 400 },
    )
  }

  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to delete a proposal." },
      { status: 401 },
    )
  }

  const existing = await getProposalById(parsed.data)
  if (!existing) {
    return NextResponse.json({ ok: true })
  }

  // Compare by public-key bytes - a Canary-prefix session (cn…) must still
  // match a proposer stored under the Enjin Relay prefix (en…).
  await initializeWasm()
  if (!samePublicKey(existing.proposer_address, me.address)) {
    return NextResponse.json(
      { ok: false, error: "Only the proposer can delete this proposal." },
      { status: 403 },
    )
  }

  if (existing.status === "on_chain") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Proposal is already on-chain - deleting the DB row wouldn't undo it.",
      },
      { status: 409 },
    )
  }

  // Gather the R2 keys BEFORE the row (and its cascade-deleted attachment
  // rows) are gone, so we can clean the bucket after: the whole folder when
  // it can be listed (every staged JSON version and every upload, listed or
  // not - a held or hidden file must not outlive its draft), else the
  // current JSON plus the listed attachments.
  const ownPrefix = proposalPrefix(existing.network, existing.id)
  let r2Keys: string[] = [existing.json_key]
  let folderListed = false
  if (isR2Configured()) {
    try {
      r2Keys = r2Keys.concat(await listObjectKeys(ownPrefix))
      folderListed = true
    } catch {
      // fall back to the rows below
    }
  }
  if (!folderListed) {
    try {
      const attachments = await listAttachments(existing.id)
      r2Keys = r2Keys.concat(attachments.flatMap((a) => [a.bucket_key, thumbKeyFor(a.bucket_key)]))
    } catch {
      // attachment lookup is best-effort; the json key alone still gets cleaned
    }
  }

  // Only ever delete objects inside this proposal's own folder. Attachment
  // keys were supplied by the client when the draft was staged, so a stored
  // key pointing elsewhere (another proposal's JSON, an avatar) is skipped
  // rather than trusted.
  r2Keys = [...new Set(r2Keys)].filter(
    (k) => k.startsWith(ownPrefix) && !k.split("/").includes(".."),
  )

  // A draft whose batch landed but was never linked is still pinned on
  // chain, possibly from an older staged version. Its files must stay.
  // Fails closed: if the chain can't be read, nothing is deleted.
  try {
    if (await anyVersionOnChain(existing, r2Keys.filter(isProposalJsonKey))) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This draft already reached the chain. Link it to its referendum from your drafts instead.",
        },
        { status: 409 },
      )
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach the chain to check this draft - try again." },
      { status: 503 },
    )
  }

  // The SQL refuses an on-chain row, so a confirm that landed in the
  // meantime keeps its row - and then its files.
  if (!(await deleteProposalById(parsed.data))) {
    return NextResponse.json(
      { ok: false, error: "Proposal is already on-chain - deleting it isn't possible." },
      { status: 409 },
    )
  }

  if (isR2Configured()) {
    try {
      await deleteObjects(r2Keys)
    } catch {
      // Best-effort: the DB row is gone; a stray blob is harmless and can be
      // swept later. Never fail the delete on a bucket hiccup.
    }
  }

  return NextResponse.json({ ok: true })
}

/** Whether any stored JSON version of a draft is pinned by an on-chain envelope. */
async function anyVersionOnChain(
  row: { network: string; json_url: string; json_key: string; json_sha256: string },
  jsonKeys: string[],
): Promise<boolean> {
  if (row.json_url && row.json_sha256) {
    if (await isEnvelopeOnChain(row.network, row.json_url, row.json_sha256)) return true
  }
  for (const key of jsonKeys) {
    if (key === row.json_key) continue
    const text = await readObjectText(key)
    if (text == null) continue
    const sha = createHash("sha256").update(text, "utf8").digest("hex")
    if (await isEnvelopeOnChain(row.network, publicUrlFor(publicAssetBase(), key), sha)) {
      return true
    }
  }
  return false
}

/**
 * True only when the referendum is in a known terminal state (anything other
 * than Ongoing). Once decided, the off-chain narrative is frozen so an edit
 * can't misrepresent what was approved or rejected. Fails OPEN on RPC errors
 * or a not-found/pruned referendum - a transient chain issue shouldn't block a
 * legitimate edit, and the on-chain hash divergence still flags any change.
 */
async function referendumConcluded(
  network: string,
  index: number,
): Promise<boolean> {
  const chain = CHAINS[network as ChainId]
  if (!chain) return false
  try {
    const api = await getApi(chain.rpc)
    const ref = await getReferendum(api, index)
    return ref != null && ref.status.type !== "Ongoing"
  } catch {
    return false
  }
}

const attachmentSchema = z.object({
  bucket_key: z.string().min(1),
  name: z.string().min(1).max(255),
  url: z.string().url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  content_type: z.string().min(1).max(120),
  size_bytes: z.number().int().positive(),
})

const patchSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(500).nullable(),
  body_markdown: z.string().max(100_000),
  attachments: z.array(attachmentSchema).max(20).default([]),
})

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ uuid: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }
  if (!isR2Configured()) {
    return NextResponse.json(
      { ok: false, error: "Storage is not configured" },
      { status: 503 },
    )
  }

  const { uuid: raw } = await context.params
  const idParse = uuidSchema.safeParse(raw)
  if (!idParse.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid proposal uuid" },
      { status: 400 },
    )
  }

  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to edit a proposal." },
      { status: 401 },
    )
  }
  const suspended = await postingSuspendedResponse(me)
  if (suspended) return suspended
  const rl = await enforceRateLimit({ ...RATE_LIMITS.proposalDraft, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many edits - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  const existing = await getProposalById(idParse.data)
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Proposal not found" },
      { status: 404 },
    )
  }
  // Compare by public-key bytes - the same wallet may have a Canary-
  // prefix session (cn…) while the proposer was stored in the Enjin
  // Relay prefix (en…). String equality would reject a legitimate edit.
  await initializeWasm()
  if (!samePublicKey(existing.proposer_address, me.address)) {
    return NextResponse.json(
      { ok: false, error: "Only the proposer can edit this proposal." },
      { status: 403 },
    )
  }
  // Drafts change by being staged again (which keeps every signed version);
  // this route only edits proposals whose referendum exists.
  if (existing.status !== "on_chain") {
    return NextResponse.json(
      { ok: false, error: "Only proposals that reached the chain can be edited here." },
      { status: 409 },
    )
  }

  // Once the referendum has concluded (approved, rejected, etc.) its proposal
  // text is the historical record of what was decided - freeze it.
  if (
    existing.referendum_index != null &&
    (await referendumConcluded(existing.network, existing.referendum_index))
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This referendum has concluded - its proposal can no longer be edited.",
      },
      { status: 409 },
    )
  }

  let parsed
  try {
    parsed = patchSchema.parse(await request.json())
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    )
  }

  // Same rule as the draft route: every attachment key must sit in this
  // proposal's own media folder, and the URL written into the JSON is built
  // from that key rather than taken from the browser. Checked before
  // anything is written.
  const attachmentKeys: string[] = []
  const attachmentUrls: string[] = []
  for (const att of parsed.attachments) {
    const ownKey = ownMediaKey(att.bucket_key, existing.network, existing.id)
    if (!ownKey) {
      return NextResponse.json(
        { ok: false, error: `Attachment "${att.name}" doesn't belong to this proposal.` },
        { status: 400 },
      )
    }
    attachmentKeys.push(ownKey)
    attachmentUrls.push(publicUrlFor(publicAssetBase(), ownKey))
  }

  const editedAt = new Date().toISOString()

  // The JSON is rebuilt from the DB row plus the edited text. The 1.2.0
  // call / enactment sections only live in the JSON, so carry them over
  // from the current version (only this server writes that object).
  let carried: Pick<ProposalJson, "call" | "enactment"> | null = null
  try {
    const current = await readObjectText(existing.json_key)
    const prev = current ? (JSON.parse(current) as Partial<ProposalJson>) : null
    if (prev && (prev.call != null || prev.enactment != null)) {
      carried = { call: prev.call ?? null, enactment: prev.enactment ?? null }
    }
  } catch {
    // Unreadable current JSON: the edit still saves, without the section.
  }

  const proposalJson: ProposalJson = {
    schema: PROPOSAL_SCHEMA,
    version: carried ? PROPOSAL_SCHEMA_VERSION_WITH_CALL : PROPOSAL_SCHEMA_VERSION,
    network: existing.network as ProposalJson["network"],
    proposer: existing.proposer_address,
    title: parsed.title,
    summary: parsed.summary,
    body_markdown: parsed.body_markdown,
    track: existing.track,
    spend:
      existing.beneficiary && existing.amount_planck
        ? {
            beneficiary: existing.beneficiary,
            amount_planck: existing.amount_planck,
          }
        : null,
    attachments: parsed.attachments.map(
      (a, i): ProposalAttachmentMeta => ({
        name: a.name,
        url: attachmentUrls[i]!,
        sha256: a.sha256,
        content_type: a.content_type,
        size_bytes: a.size_bytes,
      }),
    ),
    ...(carried ?? {}),
    preimage_hash: existing.preimage_hash,
    preimage_len: existing.preimage_len,
    created_at: existing.created_at.toISOString(),
    edited_at: editedAt,
    edit_count: existing.edit_count + 1,
    signature: null,
  }

  let put
  try {
    put = await putJson(existing.json_key, proposalJson)
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `R2 upload failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    )
  }

  let row
  try {
    row = await updateProposalContent({
      id: existing.id,
      title: parsed.title,
      summary: parsed.summary,
      bodyMarkdown: parsed.body_markdown,
      jsonUrl: put.url,
      jsonSha256: put.sha256,
    })
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `Db update failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    )
  }

  const replacementItems: ReplaceAttachmentItem[] = parsed.attachments.map(
    (a, i) => ({
      bucketKey: attachmentKeys[i]!,
      url: attachmentUrls[i]!,
      filename: a.name,
      contentType: a.content_type,
      sizeBytes: a.size_bytes,
      sha256: a.sha256,
      uploadedBy: me.id,
    }),
  )
  try {
    await replaceAttachments(existing.id, replacementItems)
  } catch {
    // Best-effort - the JSON already carries the authoritative list.
  }

  // Only changed text is checked again.
  if (
    parsed.title !== existing.title ||
    (parsed.summary ?? null) !== (existing.summary ?? null) ||
    parsed.body_markdown !== existing.body_markdown
  ) {
    flagText({
      targetType: "proposal",
      targetId: existing.id,
      proposalId: existing.id,
      text: [parsed.title, parsed.summary ?? "", parsed.body_markdown].join("\n\n"),
    })
  }

  return NextResponse.json({
    ok: true,
    id: row.id,
    json_url: row.json_url,
    json_sha256: row.json_sha256,
    edited_at: row.edited_at,
    edit_count: row.edit_count,
    proposal: proposalJson,
  })
}

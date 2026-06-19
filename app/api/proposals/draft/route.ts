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
 *     remark_payload,      // exact string to put in system.remark
 *     proposal             // the proposal.json contents (for preview)
 *   }
 *
 * Auth: requires a signed-in session, and the supplied proposer_address
 * must be the session's own wallet (matched by public key). A draft row
 * is still not cryptographic proof of authorship - the JSON's optional
 * `signature` field isn't verified - but it can no longer be filed
 * anonymously or under someone else's address.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { initializeWasm, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import {
  insertProposalDraft,
  insertAttachment,
  type CreateProposalDraft,
} from "@/lib/db/proposals"
import { upsertUserByAddress } from "@/lib/db/users"
import { isR2Configured } from "@/lib/r2/client"
import { proposalJsonKey } from "@/lib/r2/paths"
import { putJson } from "@/lib/r2/upload"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  buildRemarkPayload,
  PROPOSAL_SCHEMA,
  PROPOSAL_SCHEMA_VERSION,
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

  const key = proposalJsonKey(parsed.network, parsed.proposal_id)

  const proposalJson: ProposalJson = {
    schema: PROPOSAL_SCHEMA,
    version: PROPOSAL_SCHEMA_VERSION,
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
    attachments: parsed.attachments.map(
      (a): ProposalAttachmentMeta => ({
        name: a.name,
        url: a.url,
        sha256: a.sha256,
        content_type: a.content_type,
        size_bytes: a.size_bytes,
      }),
    ),
    preimage_hash: parsed.preimage_hash,
    preimage_len: parsed.preimage_len,
    created_at: new Date().toISOString(),
    signature: null,
  }

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
    return NextResponse.json(
      { ok: false, error: `Db insert failed: ${raw}` },
      { status: 502 },
    )
  }

  for (const att of parsed.attachments) {
    try {
      await insertAttachment({
        proposalId: row.id,
        bucketKey: att.bucket_key,
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

/**
 * Off-chain proposal mirror.
 *
 * The R2 JSON blob remains the source of truth - these rows just give us
 * a fast index and a place to attach mutable adjuncts (comments, edits).
 * On-chain referendum_index is filled in *after* batchAll finalises.
 */

import "server-only"
import { getSql } from "./client"

export type ProposalStatus =
  | "draft"
  | "submitted"
  | "on_chain"
  | "failed"
  | "cancelled"

export type ProposalRow = {
  id: string
  network: string
  referendum_index: number | null
  proposer_user_id: string | null
  proposer_address: string
  title: string
  summary: string | null
  body_markdown: string
  track: string | null
  beneficiary: string | null
  amount_planck: string | null
  json_url: string
  json_key: string
  json_sha256: string
  proposer_signature: string | null
  preimage_hash: string | null
  preimage_len: number | null
  remark_payload: string | null
  tx_hash: string | null
  block_hash: string | null
  block_number: number | null
  status: ProposalStatus
  last_error: string | null
  edited_at: Date | null
  edit_count: number
  withdrawn_at: Date | null
  withdrawn_reason: string | null
  created_at: Date
  updated_at: Date
}

export type CreateProposalDraft = {
  /** Client-minted UUID; must match the proposal_id used in R2 keys. */
  id: string
  network: string
  proposerUserId: string | null
  proposerAddress: string
  title: string
  summary: string | null
  bodyMarkdown: string
  track: string | null
  beneficiary: string | null
  amountPlanck: bigint | null
  jsonUrl: string
  jsonKey: string
  jsonSha256: string
  proposerSignature: string | null
  preimageHash: string | null
  preimageLen: number | null
  remarkPayload: string | null
}

export async function insertProposalDraft(
  d: CreateProposalDraft,
): Promise<ProposalRow> {
  const sql = getSql()
  const rows = (await sql`
    INSERT INTO proposals (
      id, network, proposer_user_id, proposer_address,
      title, summary, body_markdown,
      track, beneficiary, amount_planck,
      json_url, json_key, json_sha256, proposer_signature,
      preimage_hash, preimage_len, remark_payload,
      status
    ) VALUES (
      ${d.id}, ${d.network}, ${d.proposerUserId}, ${d.proposerAddress},
      ${d.title}, ${d.summary}, ${d.bodyMarkdown},
      ${d.track}, ${d.beneficiary}, ${d.amountPlanck?.toString() ?? null},
      ${d.jsonUrl}, ${d.jsonKey}, ${d.jsonSha256}, ${d.proposerSignature},
      ${d.preimageHash}, ${d.preimageLen}, ${d.remarkPayload},
      'draft'
    )
    RETURNING *
  `) as ProposalRow[]
  return rows[0]
}

export type UpdateProposalDraftArgs = {
  id: string
  /** The row's current json_sha256 - the update only applies if it still matches. */
  expectedSha256: string
  title: string
  summary: string | null
  bodyMarkdown: string
  track: string | null
  beneficiary: string | null
  amountPlanck: bigint | null
  jsonUrl: string
  jsonKey: string
  jsonSha256: string
  preimageHash: string | null
  preimageLen: number | null
  remarkPayload: string | null
}

/**
 * Re-stage an unsigned draft in place (same id, same R2 key). Only applies
 * while the row is still a draft and nobody else changed it in the meantime;
 * returns null otherwise.
 */
export async function updateProposalDraft(
  d: UpdateProposalDraftArgs,
): Promise<ProposalRow | null> {
  const sql = getSql()
  const rows = (await sql`
    UPDATE proposals SET
      title          = ${d.title},
      summary        = ${d.summary},
      body_markdown  = ${d.bodyMarkdown},
      track          = ${d.track},
      beneficiary    = ${d.beneficiary},
      amount_planck  = ${d.amountPlanck?.toString() ?? null},
      json_url       = ${d.jsonUrl},
      json_key       = ${d.jsonKey},
      json_sha256    = ${d.jsonSha256},
      preimage_hash  = ${d.preimageHash},
      preimage_len   = ${d.preimageLen},
      remark_payload = ${d.remarkPayload}
    WHERE id = ${d.id}
      AND status = 'draft'
      AND json_sha256 = ${d.expectedSha256}
    RETURNING *
  `) as ProposalRow[]
  return rows[0] ?? null
}

export type AttachReferendumArgs = {
  proposalId: string
  referendumIndex: number
  /** Null when a proposer links an existing referendum by hand. */
  txHash: string | null
  blockHash: string | null
  blockNumber: number | null
}

/**
 * Called after the `utility.batchAll` finalises and we've read the
 * `Referenda.Submitted` event. Atomically flips status → on_chain
 * and locks in the on-chain coordinates.
 */
export async function attachReferendumIndex(
  a: AttachReferendumArgs,
): Promise<ProposalRow> {
  const sql = getSql()
  const rows = (await sql`
    UPDATE proposals SET
      referendum_index = ${a.referendumIndex},
      tx_hash          = ${a.txHash},
      block_hash       = ${a.blockHash},
      block_number     = ${a.blockNumber},
      status           = 'on_chain'
    WHERE id = ${a.proposalId}
    RETURNING *
  `) as ProposalRow[]
  if (rows.length === 0) throw new Error(`No proposal ${a.proposalId}`)
  return rows[0]
}

export type UpdateProposalContentArgs = {
  id: string
  title: string
  summary: string | null
  bodyMarkdown: string
  jsonUrl: string
  jsonSha256: string
}

/**
 * Apply a proposer-driven edit to the off-chain narrative. Bumps
 * `edit_count` and stamps `edited_at`. The on-chain envelope + the
 * row's `remark_payload` are intentionally untouched - they still
 * pin the original sha256, and divergence is the expected signal
 * that an edit happened.
 */
export async function updateProposalContent(
  a: UpdateProposalContentArgs,
): Promise<ProposalRow> {
  const sql = getSql()
  const rows = (await sql`
    UPDATE proposals SET
      title         = ${a.title},
      summary       = ${a.summary},
      body_markdown = ${a.bodyMarkdown},
      json_url      = ${a.jsonUrl},
      json_sha256   = ${a.jsonSha256},
      edited_at     = NOW(),
      edit_count    = edit_count + 1
    WHERE id = ${a.id}
    RETURNING *
  `) as ProposalRow[]
  if (rows.length === 0) throw new Error(`No proposal ${a.id}`)
  return rows[0]
}

export type ReplaceAttachmentItem = {
  bucketKey: string
  url: string
  filename: string
  contentType: string
  sizeBytes: number
  sha256: string
  uploadedBy: string | null
}

/**
 * Replace the attachment list for a proposal: deletes every existing
 * row and inserts the supplied set. Used by the edit endpoint after
 * the new proposal.json is in R2.
 */
export async function replaceAttachments(
  proposalId: string,
  items: ReadonlyArray<ReplaceAttachmentItem>,
): Promise<void> {
  const sql = getSql()
  await sql`DELETE FROM proposal_attachments WHERE proposal_id = ${proposalId}`
  for (const a of items) {
    await sql`
      INSERT INTO proposal_attachments (
        proposal_id, bucket_key, url, filename,
        content_type, size_bytes, sha256, uploaded_by
      ) VALUES (
        ${proposalId}, ${a.bucketKey}, ${a.url}, ${a.filename},
        ${a.contentType}, ${a.sizeBytes}, ${a.sha256}, ${a.uploadedBy}
      )
      ON CONFLICT (bucket_key) DO NOTHING
    `
  }
}

/**
 * Flag/unflag an on-chain proposal as withdrawn by its proposer. Status
 * stays unchanged - the chain still hosts the referendum and voting is
 * still open. Reason is an optional short note the banner shows.
 */
export async function setProposalWithdrawn(
  id: string,
  reason: string | null,
  withdrawn: boolean,
): Promise<ProposalRow> {
  const sql = getSql()
  const rows = (withdrawn
    ? await sql`
        UPDATE proposals SET
          withdrawn_at     = NOW(),
          withdrawn_reason = ${reason}
        WHERE id = ${id}
        RETURNING *
      `
    : await sql`
        UPDATE proposals SET
          withdrawn_at     = NULL,
          withdrawn_reason = NULL
        WHERE id = ${id}
        RETURNING *
      `) as ProposalRow[]
  if (rows.length === 0) throw new Error(`No proposal ${id}`)
  return rows[0]
}

export async function markProposalFailed(
  proposalId: string,
  error: string,
): Promise<void> {
  const sql = getSql()
  await sql`
    UPDATE proposals SET status = 'failed', last_error = ${error}
    WHERE id = ${proposalId}
  `
}

/** Null when the row is gone or reached the chain in the meantime. */
export async function markProposalCancelled(
  proposalId: string,
  reason: string | null,
): Promise<ProposalRow | null> {
  const sql = getSql()
  const rows = (await sql`
    UPDATE proposals SET
      status = 'cancelled',
      last_error = ${reason ?? "Marked outdated by proposer"}
    WHERE id = ${proposalId}
      AND status <> 'on_chain'
    RETURNING *
  `) as ProposalRow[]
  return rows[0] ?? null
}

export async function listProposalsByProposer(
  network: string,
  address: string,
): Promise<ProposalRow[]> {
  const sql = getSql()
  return (await sql`
    SELECT * FROM proposals
    WHERE network = ${network} AND proposer_address = ${address}
    ORDER BY created_at DESC
    LIMIT 50
  `) as ProposalRow[]
}

export async function listProposalsWithIndex(
  network: string,
): Promise<ProposalRow[]> {
  const sql = getSql()
  return (await sql`
    SELECT * FROM proposals
    WHERE network = ${network} AND referendum_index IS NOT NULL
    ORDER BY referendum_index DESC
    LIMIT 500
  `) as ProposalRow[]
}

export async function getProposalByIndex(
  network: string,
  referendumIndex: number,
): Promise<ProposalRow | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT * FROM proposals
    WHERE network = ${network} AND referendum_index = ${referendumIndex}
    LIMIT 1
  `) as ProposalRow[]
  return rows[0] ?? null
}

/**
 * Bulk variant for list views that would otherwise fan out into one
 * `/api/proposals/by-index/[idx]` request per card. Missing indices are
 * simply absent - the caller maps by `referendum_index`.
 */
export async function getProposalsByIndices(
  network: string,
  referendumIndices: ReadonlyArray<number>,
): Promise<ProposalRow[]> {
  if (referendumIndices.length === 0) return []
  const sql = getSql()
  return (await sql`
    SELECT * FROM proposals
    WHERE network = ${network}
      AND referendum_index = ANY(${referendumIndices as number[]})
  `) as ProposalRow[]
}

export async function getProposalById(id: string): Promise<ProposalRow | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT * FROM proposals WHERE id = ${id} LIMIT 1
  `) as ProposalRow[]
  return rows[0] ?? null
}

/**
 * Hard-deletes a proposal row. Attachments + comments cascade. Only the
 * route should call this - it enforces the "must be cancelled/draft/failed
 * before delete" rule (on_chain rows are never deletable).
 */
/** Never deletes an on-chain row, even if one was confirmed a moment ago. */
export async function deleteProposalById(id: string): Promise<boolean> {
  const sql = getSql()
  const rows = (await sql`
    DELETE FROM proposals WHERE id = ${id} AND status <> 'on_chain' RETURNING id
  `) as unknown[]
  return rows.length > 0
}

export type AttachmentRow = {
  id: string
  proposal_id: string
  bucket_key: string
  url: string
  filename: string
  content_type: string
  size_bytes: number
  sha256: string
  uploaded_by: string | null
  created_at: Date
}

export type InsertAttachmentArgs = {
  proposalId: string
  bucketKey: string
  url: string
  filename: string
  contentType: string
  sizeBytes: number
  sha256: string
  uploadedBy: string | null
}

export async function insertAttachment(
  a: InsertAttachmentArgs,
): Promise<AttachmentRow> {
  const sql = getSql()
  const rows = (await sql`
    INSERT INTO proposal_attachments (
      proposal_id, bucket_key, url, filename,
      content_type, size_bytes, sha256, uploaded_by
    ) VALUES (
      ${a.proposalId}, ${a.bucketKey}, ${a.url}, ${a.filename},
      ${a.contentType}, ${a.sizeBytes}, ${a.sha256}, ${a.uploadedBy}
    )
    RETURNING *
  `) as AttachmentRow[]
  return rows[0]
}

export async function listAttachments(
  proposalId: string,
): Promise<AttachmentRow[]> {
  const sql = getSql()
  return (await sql`
    SELECT * FROM proposal_attachments
    WHERE proposal_id = ${proposalId}
    ORDER BY created_at ASC
  `) as AttachmentRow[]
}

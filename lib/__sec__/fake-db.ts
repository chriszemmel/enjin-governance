/**
 * In-memory stand-in for @/lib/db/proposals that mimics the SQL constraints
 * from scripts/004_proposals_comments_profiles.sql:
 *   - proposals.id is PRIMARY KEY  -> duplicate insert throws proposals_pkey
 *   - proposal_attachments.bucket_key is UNIQUE (global) -> dup throws
 *   - deleteProposalById cascades to proposal_attachments (ON DELETE CASCADE)
 *   - replaceAttachments deletes then inserts ON CONFLICT (bucket_key) DO NOTHING
 */

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
  status: "draft" | "submitted" | "on_chain" | "failed" | "cancelled"
  last_error: string | null
  edited_at: Date | null
  edit_count: number
  withdrawn_at: Date | null
  withdrawn_reason: string | null
  created_at: Date
  updated_at: Date
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

export const proposals = new Map<string, ProposalRow>()
export const attachments: AttachmentRow[] = []
let attId = 0

export function reset(): void {
  proposals.clear()
  attachments.length = 0
  attId = 0
}

export function seedProposal(p: Partial<ProposalRow> & { id: string; proposer_address: string; network: string; json_key: string }): ProposalRow {
  const now = new Date()
  const row: ProposalRow = {
    id: p.id,
    network: p.network,
    referendum_index: p.referendum_index ?? null,
    proposer_user_id: p.proposer_user_id ?? null,
    proposer_address: p.proposer_address,
    title: p.title ?? "Victim proposal",
    summary: p.summary ?? null,
    body_markdown: p.body_markdown ?? "",
    track: p.track ?? null,
    beneficiary: p.beneficiary ?? null,
    amount_planck: p.amount_planck ?? null,
    json_url: p.json_url ?? `https://fake.local/r/${p.json_key}`,
    json_key: p.json_key,
    json_sha256: p.json_sha256 ?? "0".repeat(64),
    proposer_signature: null,
    preimage_hash: p.preimage_hash ?? null,
    preimage_len: p.preimage_len ?? null,
    remark_payload: p.remark_payload ?? null,
    tx_hash: null,
    block_hash: null,
    block_number: null,
    status: p.status ?? "draft",
    last_error: null,
    edited_at: null,
    edit_count: p.edit_count ?? 0,
    withdrawn_at: null,
    withdrawn_reason: null,
    created_at: now,
    updated_at: now,
  }
  proposals.set(row.id, row)
  return row
}

export function seedAttachment(a: { proposal_id: string; bucket_key: string; url?: string }): AttachmentRow {
  const row: AttachmentRow = {
    id: `att-${++attId}`,
    proposal_id: a.proposal_id,
    bucket_key: a.bucket_key,
    url: a.url ?? `https://fake.local/r/${a.bucket_key}`,
    filename: "seed.png",
    content_type: "image/png",
    size_bytes: 123,
    sha256: "a".repeat(64),
    uploaded_by: null,
    created_at: new Date(),
  }
  attachments.push(row)
  return row
}

// --- functions matching @/lib/db/proposals signatures used by the routes ---

type CreateProposalDraft = {
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

export async function insertProposalDraft(d: CreateProposalDraft): Promise<ProposalRow> {
  if (proposals.has(d.id)) {
    // Real Postgres primary-key violation on proposals(id).
    throw new Error(
      `duplicate key value violates unique constraint "proposals_pkey"`,
    )
  }
  const now = new Date()
  const row: ProposalRow = {
    id: d.id,
    network: d.network,
    referendum_index: null,
    proposer_user_id: d.proposerUserId,
    proposer_address: d.proposerAddress,
    title: d.title,
    summary: d.summary,
    body_markdown: d.bodyMarkdown,
    track: d.track,
    beneficiary: d.beneficiary,
    amount_planck: d.amountPlanck?.toString() ?? null,
    json_url: d.jsonUrl,
    json_key: d.jsonKey,
    json_sha256: d.jsonSha256,
    proposer_signature: d.proposerSignature,
    preimage_hash: d.preimageHash,
    preimage_len: d.preimageLen,
    remark_payload: d.remarkPayload,
    tx_hash: null,
    block_hash: null,
    block_number: null,
    status: "draft",
    last_error: null,
    edited_at: null,
    edit_count: 0,
    withdrawn_at: null,
    withdrawn_reason: null,
    created_at: now,
    updated_at: now,
  }
  proposals.set(row.id, row)
  return row
}

export async function updateProposalDraft(d: {
  id: string
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
}): Promise<ProposalRow | null> {
  const row = proposals.get(d.id)
  if (!row || row.status !== "draft" || row.json_sha256 !== d.expectedSha256) return null
  Object.assign(row, {
    title: d.title,
    summary: d.summary,
    body_markdown: d.bodyMarkdown,
    track: d.track,
    beneficiary: d.beneficiary,
    amount_planck: d.amountPlanck?.toString() ?? null,
    json_url: d.jsonUrl,
    json_key: d.jsonKey,
    json_sha256: d.jsonSha256,
    preimage_hash: d.preimageHash,
    preimage_len: d.preimageLen,
    remark_payload: d.remarkPayload,
    updated_at: new Date(),
  })
  return row
}

type InsertAttachmentArgs = {
  proposalId: string
  bucketKey: string
  url: string
  filename: string
  contentType: string
  sizeBytes: number
  sha256: string
  uploadedBy: string | null
}

export async function insertAttachment(a: InsertAttachmentArgs): Promise<AttachmentRow> {
  if (attachments.some((r) => r.bucket_key === a.bucketKey)) {
    // Real Postgres UNIQUE violation on proposal_attachments(bucket_key).
    throw new Error(
      `duplicate key value violates unique constraint "proposal_attachments_bucket_key_key"`,
    )
  }
  const row: AttachmentRow = {
    id: `att-${++attId}`,
    proposal_id: a.proposalId,
    bucket_key: a.bucketKey,
    url: a.url,
    filename: a.filename,
    content_type: a.contentType,
    size_bytes: a.sizeBytes,
    sha256: a.sha256,
    uploaded_by: a.uploadedBy,
    created_at: new Date(),
  }
  attachments.push(row)
  return row
}

export async function getProposalById(id: string): Promise<ProposalRow | null> {
  // A snapshot, like a real query - a live object would hide races.
  const row = proposals.get(id)
  return row ? { ...row } : null
}

export async function listAttachments(proposalId: string): Promise<AttachmentRow[]> {
  return attachments
    .filter((r) => r.proposal_id === proposalId)
    .sort((x, y) => x.created_at.getTime() - y.created_at.getTime())
}

export async function deleteProposalById(id: string): Promise<boolean> {
  const row = proposals.get(id)
  if (!row || row.status === "on_chain") return false
  proposals.delete(id)
  // ON DELETE CASCADE
  for (let i = attachments.length - 1; i >= 0; i -= 1) {
    if (attachments[i].proposal_id === id) attachments.splice(i, 1)
  }
  return true
}

type UpdateProposalContentArgs = {
  id: string
  title: string
  summary: string | null
  bodyMarkdown: string
  jsonUrl: string
  jsonSha256: string
}

export async function updateProposalContent(a: UpdateProposalContentArgs): Promise<ProposalRow> {
  const row = proposals.get(a.id)
  if (!row) throw new Error(`No proposal ${a.id}`)
  row.title = a.title
  row.summary = a.summary
  row.body_markdown = a.bodyMarkdown
  row.json_url = a.jsonUrl
  row.json_sha256 = a.jsonSha256
  row.edited_at = new Date()
  row.edit_count += 1
  return row
}

type ReplaceAttachmentItem = {
  bucketKey: string
  url: string
  filename: string
  contentType: string
  sizeBytes: number
  sha256: string
  uploadedBy: string | null
}

export async function replaceAttachments(
  proposalId: string,
  items: ReadonlyArray<ReplaceAttachmentItem>,
): Promise<void> {
  // DELETE FROM proposal_attachments WHERE proposal_id = $1
  for (let i = attachments.length - 1; i >= 0; i -= 1) {
    if (attachments[i].proposal_id === proposalId) attachments.splice(i, 1)
  }
  // INSERT ... ON CONFLICT (bucket_key) DO NOTHING
  for (const a of items) {
    if (attachments.some((r) => r.bucket_key === a.bucketKey)) continue
    attachments.push({
      id: `att-${++attId}`,
      proposal_id: proposalId,
      bucket_key: a.bucketKey,
      url: a.url,
      filename: a.filename,
      content_type: a.contentType,
      size_bytes: a.sizeBytes,
      sha256: a.sha256,
      uploaded_by: a.uploadedBy,
      created_at: new Date(),
    })
  }
}

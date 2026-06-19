/**
 * Off-chain proposal-metadata standard for the Enjin Governance app.
 *
 * The "Standard":
 *   1. The proposer composes a JSON blob describing the proposal
 *      (title, body, attachments, beneficiary, amount, preimage hash).
 *   2. The blob is uploaded to a public bucket at a stable URL.
 *   3. The bucket URL + sha256 of the bytes is embedded as a
 *      `system.remark(<bytes>)` call inside the same `utility.batchAll`
 *      as `preimage.notePreimage` + `referenda.submit`. Atomicity of the
 *      batch guarantees the remark can never reference a referendum that
 *      wasn't actually submitted.
 *
 * Remark payload format (UTF-8 bytes of the string):
 *
 *   EGOV1:{"u":"<url>","h":"<sha256-hex>"}
 *
 * - `EGOV1:` magic prefix is cheap to filter for in remark call args.
 * - The JSON body is deliberately minimal - full metadata is at `u`.
 * - `h` is the sha256 of the canonical (sorted-keys) JSON bytes.
 *
 * Anyone - including non-Enjin clients - can index proposals without a
 * database by decoding `system.remark` call args from finalised blocks
 * (the remark is nested in the proposal's `utility.batchAll`), filtering
 * for `EGOV1:`, parsing the JSON, and fetching the URL.
 */

import type { ChainId } from "@/lib/chain/chains"

export const REMARK_MAGIC = "EGOV1:"
export const PROPOSAL_SCHEMA = "enjin-governance-proposal"
export const PROPOSAL_SCHEMA_VERSION = "1.1.0"

export type ProposalAttachmentMeta = {
  name: string
  url: string
  sha256: string
  content_type: string
  size_bytes: number
}

/**
 * Canonical shape of `proposal.json`. The `signature` field is set last,
 * after the proposer signs the canonical JSON of the body-minus-signature.
 */
export type ProposalJson = {
  schema: typeof PROPOSAL_SCHEMA
  version: typeof PROPOSAL_SCHEMA_VERSION
  network: ChainId
  proposer: string
  title: string
  summary: string | null
  body_markdown: string
  track: string | null
  spend: {
    beneficiary: string
    amount_planck: string
  } | null
  attachments: ProposalAttachmentMeta[]
  preimage_hash: string | null
  preimage_len: number | null
  created_at: string
  /**
   * Set whenever the proposer overwrites the JSON post-submission. The
   * on-chain `system.remark` still pins the original sha256, so an
   * external indexer can detect divergence; this field tells clients
   * the divergence is an intentional edit rather than tampering.
   */
  edited_at?: string | null
  /** Monotonically incremented on every edit. Optional for backwards compat. */
  edit_count?: number
  signature: {
    address: string
    sig: string
  } | null
}

export type RemarkEnvelope = {
  u: string
  h: string
}

/**
 * Build the bytes that go into `system.remark`. Returns a UTF-8 string
 * - the extrinsic builder should pass `stringToU8a(payload)` or pass
 * the string directly if the metadata accepts `Bytes`.
 */
export function buildRemarkPayload(url: string, sha256Hex: string): string {
  const envelope: RemarkEnvelope = { u: url, h: sha256Hex }
  return `${REMARK_MAGIC}${JSON.stringify(envelope)}`
}

/**
 * Inverse of buildRemarkPayload. Returns null if the input doesn't look
 * like one of our envelopes - callers should treat anything else as a
 * remark from a different app.
 */
export function parseRemarkPayload(raw: string): RemarkEnvelope | null {
  if (!raw.startsWith(REMARK_MAGIC)) return null
  try {
    const parsed = JSON.parse(raw.slice(REMARK_MAGIC.length)) as unknown
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as RemarkEnvelope).u === "string" &&
      typeof (parsed as RemarkEnvelope).h === "string"
    ) {
      return parsed as RemarkEnvelope
    }
    return null
  } catch {
    return null
  }
}

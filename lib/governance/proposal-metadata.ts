/**
 * Off-chain proposal-metadata standard for the Enjin Governance app.
 *
 * The "Standard":
 *   1. The proposer composes a JSON blob describing the proposal
 *      (title, body, attachments, beneficiary, amount, preimage hash).
 *   2. The blob is uploaded to a public bucket at a stable URL.
 *   3. The bucket URL + sha256 of the bytes form an envelope that is
 *      noted as its own preimage and bound to the referendum with
 *      `referenda.setMetadata(index, blake2_256(envelope))`, inside the
 *      same `utility.batchAll` as `preimage.notePreimage` +
 *      `referenda.submit`. Atomicity of the batch guarantees the
 *      metadata can never reference a referendum that wasn't actually
 *      submitted, and the runtime's depositor check guarantees nobody
 *      can annotate someone else's referendum.
 *
 * Envelope format (UTF-8 bytes of the string):
 *
 *   EGOV1:{"u":"<url>","h":"<sha256-hex>"}
 *
 * - `EGOV1:` magic prefix is cheap to filter for in call args.
 * - The JSON body is deliberately minimal - full metadata is at `u`.
 * - `h` is the sha256 of the canonical JSON bytes: keys sorted at every
 *   level, no insignificant whitespace, UTF-8. See `stringifyStable`.
 *
 * Anyone - including non-Enjin clients - can index proposals without a
 * database by reading `referenda.metadataOf(index)` and resolving the
 * hash through the `preimage` pallet to the envelope bytes.
 *
 * Referenda filed before the setMetadata anchor shipped carry the same
 * envelope as a `system.remark(<bytes>)` call co-located in the
 * submission `utility.batchAll` instead. Indexers should check both
 * bindings; the envelope format is identical in each.
 */

import { stringToU8a } from "@polkadot/util"
import type { ChainId } from "@/lib/chain/chains"
import { hashCall } from "./preimage"

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
   * on-chain envelope still pins the original sha256, so an
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
 * Build the envelope string that gets anchored on chain - noted as a
 * preimage and bound via `referenda.setMetadata` (older referenda carried
 * it in a `system.remark` instead). Returns a UTF-8 string - the extrinsic
 * builder hashes/encodes its bytes as needed.
 */
export function buildRemarkPayload(url: string, sha256Hex: string): string {
  const envelope: RemarkEnvelope = { u: url, h: sha256Hex }
  return `${REMARK_MAGIC}${JSON.stringify(envelope)}`
}

/**
 * The hash `referenda.setMetadata` binds for a given bucket URL + JSON
 * sha256: blake2-256 over the envelope's UTF-8 bytes.
 *
 * Note this is NOT the sha256 in `h` - that commits to the off-chain JSON,
 * while this commits to the envelope itself, which is what lives on chain
 * as a preimage.
 *
 * The submitting client hashes the envelope string it was handed, which is
 * self-consistent by construction. This rebuilds the same envelope from the
 * persisted url + sha256, which is all a later verifier has to work from -
 * both routes agree because both go through `buildRemarkPayload`.
 */
export function expectedMetadataHash(url: string, sha256Hex: string): `0x${string}` {
  return hashCall(stringToU8a(buildRemarkPayload(url, sha256Hex)))
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

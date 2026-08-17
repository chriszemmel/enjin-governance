/**
 * Read + write helpers for api.query.referenda + api.tx.referenda.
 *
 * All write helpers return an unsigned SubmittableExtrinsic. Signing +
 * broadcasting is the caller's job (lib/query/hooks/use-tx.ts).
 */

import type { ApiPromise, SubmittableResult } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { Call, EventRecord } from "@polkadot/types/interfaces"
import type { ISubmittableResult } from "@polkadot/types/types"
import { u8aToHex, u8aToString } from "@polkadot/util"
import { findEvent } from "@/lib/chain/events"
import { getPreimage } from "./preimage"
import { parseRemarkPayload, type RemarkEnvelope } from "./proposal-metadata"
import { decodeReferendumInfo } from "./status"
import type { PreimageRef, Referendum, ReferendumStatusType } from "./types"

/**
 * Pull the new referendum index out of a `referenda.Submitted` event in a
 * finalised extrinsic's events. Returns null if the event isn't present.
 */
export function extractReferendumIndex(
  events: EventRecord[] | readonly EventRecord[],
): number | null {
  const submitted = findEvent(events, "referenda", "Submitted")
  if (!submitted) return null
  try {
    return (submitted.data[0] as unknown as { toNumber: () => number }).toNumber()
  } catch {
    return null
  }
}

export type ReferendumFilter = {
  trackId?: number
  status?: ReferendumStatusType
}

/**
 * Page through every referendum on chain. Decodes, filters, and returns
 * sorted by index descending (newest first).
 *
 * For a few hundred referenda this is fine straight from the RPC; a
 * background snapshot would be needed before it scales much beyond that.
 */
export async function listReferenda(
  api: ApiPromise,
  filter: ReferendumFilter = {},
): Promise<Referendum[]> {
  const entries = await api.query.referenda.referendumInfoFor.entries()
  const decoded: Referendum[] = []

  for (const [key, info] of entries) {
    const index = (key.args[0] as unknown as { toNumber: () => number }).toNumber()
    const ref = decodeReferendumInfo(index, info)
    if (!ref) continue
    if (filter.trackId != null && ref.trackId !== filter.trackId) continue
    if (filter.status != null && ref.status.type !== filter.status) continue
    decoded.push(ref)
  }

  decoded.sort((a, b) => b.index - a.index)
  return decoded
}

/** Read a single referendum. Returns null if the index doesn't exist. */
export async function getReferendum(
  api: ApiPromise,
  index: number,
): Promise<Referendum | null> {
  const info = await api.query.referenda.referendumInfoFor(index)
  return decodeReferendumInfo(index, info)
}

/**
 * Read the referendum's state at the block right before its terminal
 * transition. Recovers the tally, preimage ref, and submitted block that
 * the terminal variants drop. Returns null if the state has been pruned
 * (typical for old finalised referenda).
 */
export async function getReferendumHistory(
  api: ApiPromise,
  index: number,
  atBlock: number,
): Promise<Referendum | null> {
  if (atBlock <= 1) return null
  try {
    const blockHash = await api.rpc.chain.getBlockHash(atBlock - 1)
    const apiAt = await api.at(blockHash)
    const info = await apiAt.query.referenda.referendumInfoFor(index)
    return decodeReferendumInfo(index, info)
  } catch {
    return null
  }
}

/** Count of referenda ever submitted (max index + 1). */
export async function getReferendumCount(api: ApiPromise): Promise<number> {
  const count = await api.query.referenda.referendumCount()
  return (count as unknown as { toNumber: () => number }).toNumber()
}

/**
 * The bounded proposal passed to referenda.submit. Either a Lookup ref to a
 * separately-noted preimage (a `PreimageRef`: `{ hash, len }`), or an Inline
 * proposal that embeds the call bytes directly (`{ inline: <bytes> }`) - the
 * latter avoids a preimage deposit + extra batch member for small calls.
 */
export type InlineProposal = { inline: Uint8Array }
export type SubmitProposal = PreimageRef | InlineProposal

function isInline(p: SubmitProposal): p is InlineProposal {
  return "inline" in p
}

/** Map a SubmitProposal onto the FrameSupportPreimagesBounded enum shape. */
export function boundedProposalArg(proposal: SubmitProposal): unknown {
  return isInline(proposal)
    ? { Inline: u8aToHex(proposal.inline) }
    : { Lookup: { hash: proposal.hash, len: proposal.len } }
}

export type SubmitParams = {
  /** Pallet origin to submit under, e.g. { Origins: 'SmallTipper' } or { System: 'Root' }. */
  origin: unknown
  /** Bounded proposal - a Lookup ref to a noted preimage, or an Inline call. */
  proposal: SubmitProposal
  /** Enactment moment: 'After 0' = as soon as possible after passing. */
  enactment: { type: "At" | "After"; block: number }
}

/** Build an api.tx.referenda.submit extrinsic. Does NOT sign. */
export function buildSubmit(
  api: ApiPromise,
  params: SubmitParams,
): SubmittableExtrinsic<"promise", SubmittableResult> {
  const enactmentArg =
    params.enactment.type === "At"
      ? { At: params.enactment.block }
      : { After: params.enactment.block }

  return api.tx.referenda.submit(
    params.origin,
    boundedProposalArg(params.proposal),
    enactmentArg,
  ) as SubmittableExtrinsic<"promise", SubmittableResult>
}

/**
 * Build `referenda.setMetadata(index, Some(hash))` - binds a noted preimage
 * to a referendum as its metadata. The runtime only accepts this from the
 * referendum's submission depositor while the referendum is Ongoing, and
 * only for a hash the preimage pallet can already resolve - so in a
 * submission batch this must come after both `referenda.submit` and the
 * envelope's `preimage.notePreimage`.
 */
export function buildSetMetadata(
  api: ApiPromise,
  index: number,
  hash: `0x${string}`,
): SubmittableExtrinsic<"promise", ISubmittableResult> {
  return api.tx.referenda.setMetadata(index, hash) as SubmittableExtrinsic<
    "promise",
    ISubmittableResult
  >
}

/**
 * Resolve a referendum's on-chain metadata binding to an EGOV1 envelope:
 * `referenda.metadataOf(index)` → preimage bytes → parsed `{u, h}`.
 *
 * Returns null when the referendum has no metadata, the preimage has been
 * pruned, or the bytes aren't an `EGOV1:` envelope (e.g. a plain IPFS-hash
 * metadata set by another client). `MetadataOf` stores only the hash, so the
 * length is recovered by getPreimage's status/scan fallbacks.
 */
export async function getReferendumMetadata(
  api: ApiPromise,
  index: number,
): Promise<RemarkEnvelope | null> {
  const raw = await api.query.referenda.metadataOf(index)
  const opt = raw as unknown as {
    isSome: boolean
    unwrap: () => { toHex: () => `0x${string}` }
  }
  if (!opt.isSome) return null
  const hash = opt.unwrap().toHex()
  const preimage = await getPreimage(api, { hash, len: 0 })
  if (!preimage?.bytes) return null
  return parseRemarkPayload(u8aToString(preimage.bytes))
}

/**
 * Admin/governance-on-governance calls. These return a `Call` (NOT a signed
 * extrinsic) to be wrapped by preimage + referenda.submit under the
 * appropriate privileged track/origin - no account can dispatch them directly
 * on Enjin (sudo was removed). Confirmed against enjin v1070:
 *   referenda.cancel(index) · referenda.kill(index) · whitelist.whitelistCall(hash)
 */

/** Build `referenda.cancel(index)` - stops an ongoing referendum, refunding deposits. */
export function buildCancelReferendumCall(api: ApiPromise, index: number): Call {
  return api.tx.referenda.cancel(index).method as Call
}

/** Build `referenda.kill(index)` - stops a referendum and SLASHES its deposits. */
export function buildKillReferendumCall(api: ApiPromise, index: number): Call {
  return api.tx.referenda.kill(index).method as Call
}

/** Build `whitelist.whitelistCall(callHash)` - marks a call hash whitelisted. */
export function buildWhitelistCall(api: ApiPromise, callHash: `0x${string}`): Call {
  return api.tx.whitelist.whitelistCall(callHash).method as Call
}

export function buildPlaceDecisionDeposit(
  api: ApiPromise,
  index: number,
): SubmittableExtrinsic<"promise", ISubmittableResult> {
  return api.tx.referenda.placeDecisionDeposit(index) as SubmittableExtrinsic<
    "promise",
    ISubmittableResult
  >
}

export function buildRefundSubmissionDeposit(
  api: ApiPromise,
  index: number,
): SubmittableExtrinsic<"promise", ISubmittableResult> {
  return api.tx.referenda.refundSubmissionDeposit(index) as SubmittableExtrinsic<
    "promise",
    ISubmittableResult
  >
}

export function buildRefundDecisionDeposit(
  api: ApiPromise,
  index: number,
): SubmittableExtrinsic<"promise", ISubmittableResult> {
  return api.tx.referenda.refundDecisionDeposit(index) as SubmittableExtrinsic<
    "promise",
    ISubmittableResult
  >
}

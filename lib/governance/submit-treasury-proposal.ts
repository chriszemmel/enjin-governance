/**
 * Compose the on-chain submission for a treasury referendum.
 *
 * Four calls, atomically batched:
 *
 *   1. preimage.notePreimage(<spend_local call bytes>)
 *   2. referenda.submit(<track origin>, Lookup{hash,len}, After 0)
 *   3. preimage.notePreimage(EGOV1:{"u":"<json url>","h":"<sha256>"})
 *   4. referenda.setMetadata(<index>, blake2_256(envelope bytes))
 *
 * Wrapped in `utility.batchAll` so the metadata can never reference a
 * referendum that wasn't actually submitted in the same block.
 *
 * `referendumIndex` is `referenda.referendumCount()` read at build time -
 * the index the submit in call 2 will be assigned. If another submission
 * lands first the index is stale, setMetadata fails the runtime's
 * depositor check (NoPermission), and batchAll reverts the whole thing;
 * the caller rebuilds with a fresh count and retries. A stale index can
 * never annotate someone else's referendum.
 *
 * Ordering matters: setMetadata requires an Ongoing referendum (call 2)
 * and a resolvable preimage for the envelope hash (call 3), so it must
 * come last.
 *
 * Returns the calls + the metadata derived from the preimage so the
 * staging step can display the hash + length + raw call bytes BEFORE
 * the user signs.
 */

import type { ApiPromise } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { ISubmittableResult } from "@polkadot/types/types"
import { stringToU8a, u8aToHex } from "@polkadot/util"
import type { TreasuryTier } from "./types"
import { assertTierCoversAmount, buildSpendLocalCall } from "./treasury"
import { noteAndHash } from "./preimage"
import { buildSetMetadata, buildSubmit } from "./referenda"

type BuildTreasuryProposalArgs = {
  amount: bigint
  beneficiary: string
  tier: TreasuryTier
  /** UTF-8 string produced by buildRemarkPayload(jsonUrl, sha256). */
  remarkPayload: string
  /**
   * The index referenda.submit will assign - `referendumCount()` read
   * immediately before building. Stale (another submission landed first)
   * → setMetadata returns NoPermission and the batch reverts.
   */
  referendumIndex: number
  /**
   * Enactment moment. Defaults to `After 0` (as soon as possible after
   * passing, which the runtime clamps to the track's minEnactmentPeriod).
   */
  enactment?: { type: "At" | "After"; block: number }
}

type BuiltTreasuryProposal = {
  preimageHash: `0x${string}`
  preimageLen: number
  callHex: `0x${string}`
  /** blake2-256 of the EGOV1 envelope bytes - what setMetadata binds. */
  metadataHash: `0x${string}`
  metadataLen: number
  noteTx: SubmittableExtrinsic<"promise", ISubmittableResult>
  submitTx: SubmittableExtrinsic<"promise", ISubmittableResult>
  metadataNoteTx: SubmittableExtrinsic<"promise", ISubmittableResult>
  setMetadataTx: SubmittableExtrinsic<"promise", ISubmittableResult>
  /**
   * [noteTx, submitTx, metadataNoteTx, setMetadataTx] - caller wraps in
   * utility.batchAll.
   */
  calls: SubmittableExtrinsic<"promise", ISubmittableResult>[]
}

export function buildTreasuryProposal(
  api: ApiPromise,
  args: BuildTreasuryProposalArgs,
): BuiltTreasuryProposal {
  // Defend against filing under an origin that can't authorize the spend.
  // The picked tier should already cover the amount; this catches an
  // explicit-tier mismatch (or a stale tier table) at construction rather
  // than at on-chain enactment.
  assertTierCoversAmount(args.tier, args.amount)

  const call = buildSpendLocalCall(api, {
    amount: args.amount,
    beneficiary: args.beneficiary,
  })
  const callBytes = call.toU8a()
  const callHex = u8aToHex(callBytes)

  const { extrinsic: noteTx, hash: preimageHash, len: preimageLen } =
    noteAndHash(api, callBytes)

  const submitTx = buildSubmit(api, {
    origin: { Origins: args.tier.origin },
    proposal: { hash: preimageHash, len: preimageLen },
    enactment: args.enactment ?? { type: "After", block: 0 },
  }) as SubmittableExtrinsic<"promise", ISubmittableResult>

  // The envelope is noted as its own preimage (distinct from the spend
  // call's), and setMetadata binds its blake2-256 - NOT the sha256 inside
  // the envelope, which commits to the off-chain JSON bytes instead.
  const envelopeBytes = stringToU8a(args.remarkPayload)
  const {
    extrinsic: metadataNoteTx,
    hash: metadataHash,
    len: metadataLen,
  } = noteAndHash(api, envelopeBytes)

  const setMetadataTx = buildSetMetadata(api, args.referendumIndex, metadataHash)

  return {
    preimageHash,
    preimageLen,
    callHex,
    metadataHash,
    metadataLen,
    noteTx,
    submitTx,
    metadataNoteTx,
    setMetadataTx,
    calls: [noteTx, submitTx, metadataNoteTx, setMetadataTx],
  }
}

/**
 * Compute the same `(preimage_hash, preimage_len, callHex)` without
 * touching tx submitters. Lets the UI preview the values during the
 * compose step before showing any signing prompts.
 */
export function previewPreimage(
  api: ApiPromise,
  args: { amount: bigint; beneficiary: string },
): { preimageHash: `0x${string}`; preimageLen: number; callHex: `0x${string}` } {
  const call = buildSpendLocalCall(api, args)
  const bytes = call.toU8a()
  const noted = noteAndHash(api, bytes)
  return {
    preimageHash: noted.hash,
    preimageLen: noted.len,
    callHex: u8aToHex(bytes),
  }
}

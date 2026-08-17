/**
 * Compose the on-chain submission for a treasury referendum.
 *
 * Three calls, atomically batched:
 *
 *   1. preimage.notePreimage(<spend_local call bytes>)
 *   2. referenda.submit(<track origin>, Lookup{hash,len}, After 0)
 *   3. system.remark(EGOV1:{"u":"<json url>","h":"<sha256>"})
 *
 * Wrapped in `utility.batchAll` so the remark can never reference a
 * referendum that wasn't actually submitted in the same block.
 *
 * Returns the calls + the metadata derived from the preimage so the
 * staging step can display the hash + length + raw call bytes BEFORE
 * the user signs.
 */

import type { ApiPromise } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { ISubmittableResult } from "@polkadot/types/types"
import { stringToHex, u8aToHex } from "@polkadot/util"
import type { TreasuryTier } from "./types"
import { assertTierCoversAmount, buildSpendLocalCall } from "./treasury"
import { noteAndHash } from "./preimage"
import { buildSubmit } from "./referenda"

type BuildTreasuryProposalArgs = {
  amount: bigint
  beneficiary: string
  tier: TreasuryTier
  /** UTF-8 string produced by buildRemarkPayload(jsonUrl, sha256). */
  remarkPayload: string
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
  noteTx: SubmittableExtrinsic<"promise", ISubmittableResult>
  submitTx: SubmittableExtrinsic<"promise", ISubmittableResult>
  remarkTx: SubmittableExtrinsic<"promise", ISubmittableResult>
  /** [noteTx, submitTx, remarkTx] - caller wraps in utility.batchAll. */
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

  // Pass the remark as a hex string, not a Uint8Array. polkadot.js's
  // codec on this runtime mis-decodes a bare Uint8Array as already-encoded
  // Bytes (interprets the first byte as a compact-length prefix and
  // reads a phantom payload length), throwing "Bytes: required length
  // less than remainder, expected at least N, found M". Hex strings
  // are unambiguous and round-trip cleanly.
  const remarkTx = api.tx.system.remark(
    stringToHex(args.remarkPayload),
  ) as SubmittableExtrinsic<"promise", ISubmittableResult>

  return {
    preimageHash,
    preimageLen,
    callHex,
    noteTx,
    submitTx,
    remarkTx,
    calls: [noteTx, submitTx, remarkTx],
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

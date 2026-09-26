/**
 * One-signature submission for any proposal call, with its EGOV1 details.
 *
 *   1. preimage.notePreimage(<call bytes>)     - only for calls > 128 bytes
 *   2. referenda.submit(origin, Inline | Lookup, enactment)
 *   3. preimage.notePreimage(EGOV1:{"u":…,"h":…})
 *   4. referenda.setMetadata(index, blake2_256(envelope))
 *
 * Same guarantees as the treasury flow (see submit-treasury-proposal.ts):
 * the caller wraps these in utility.batchAll, so the metadata can never
 * point at a referendum that wasn't submitted in the same extrinsic, and a
 * stale `referendumIndex` makes setMetadata fail (NoPermission) and the
 * whole batch revert.
 *
 * `attachMetadataToExisting` covers referenda filed elsewhere (polkadot.js,
 * scripts): steps 3 + 4 only. The runtime accepts setMetadata solely from
 * the referendum's submission depositor while it is ongoing.
 */

import type { ApiPromise } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { ISubmittableResult } from "@polkadot/types/types"
import { stringToU8a, u8aToHex } from "@polkadot/util"
import { canInline, hashCall, noteAndHash } from "./preimage"
import { buildSetMetadata, buildSubmit } from "./referenda"

type Tx = SubmittableExtrinsic<"promise", ISubmittableResult>

type BuildArgs = {
  /** Bare call bytes (`call.toU8a()`). */
  callBytes: Uint8Array
  origin: unknown
  enactment: { type: "At" | "After"; block: number }
  /** UTF-8 envelope from buildRemarkPayload(jsonUrl, sha256). */
  remarkPayload: string
  /** `referenda.referendumCount()` read right before building. */
  referendumIndex: number
  /**
   * The call's preimage is already on chain (an identical proposal noted
   * it): skip step 1, which would abort with preimage.AlreadyNoted.
   */
  skipNote?: boolean
  /** The envelope is already noted (see useEnvelopeNoted): skip step 3. */
  skipEnvelopeNote?: boolean
}

type BuiltProposalBatch = {
  inline: boolean
  callHex: `0x${string}`
  /** blake2-256 of the call bytes (also for inline calls, for display). */
  preimageHash: `0x${string}`
  preimageLen: number
  metadataHash: `0x${string}`
  calls: Tx[]
}

function envelopeCalls(
  api: ApiPromise,
  remarkPayload: string,
  referendumIndex: number,
  skipNote = false,
) {
  const { extrinsic, hash } = noteAndHash(api, stringToU8a(remarkPayload))
  const setMetadata = buildSetMetadata(api, referendumIndex, hash) as Tx
  return {
    metadataHash: hash,
    calls: (skipNote ? [setMetadata] : [extrinsic, setMetadata]) as Tx[],
  }
}

export function buildProposalBatch(api: ApiPromise, args: BuildArgs): BuiltProposalBatch {
  const bytes = args.callBytes
  const hash = hashCall(bytes)
  const inline = canInline(bytes)

  const calls: Tx[] = []
  if (!inline && !args.skipNote) calls.push(noteAndHash(api, bytes).extrinsic)
  calls.push(
    buildSubmit(api, {
      origin: args.origin,
      proposal: inline ? { inline: bytes } : { hash, len: bytes.length },
      enactment: args.enactment,
    }) as Tx,
  )
  const envelope = envelopeCalls(
    api,
    args.remarkPayload,
    args.referendumIndex,
    args.skipEnvelopeNote,
  )
  calls.push(...envelope.calls)

  return {
    inline,
    callHex: u8aToHex(bytes),
    preimageHash: hash,
    preimageLen: bytes.length,
    metadataHash: envelope.metadataHash,
    calls,
  }
}

export function attachMetadataToExisting(
  api: ApiPromise,
  args: { remarkPayload: string; referendumIndex: number; skipEnvelopeNote?: boolean },
): { metadataHash: `0x${string}`; calls: Tx[] } {
  return envelopeCalls(api, args.remarkPayload, args.referendumIndex, args.skipEnvelopeNote)
}

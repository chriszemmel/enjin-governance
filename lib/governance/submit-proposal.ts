/**
 * Compose the on-chain submission for any referendum the advanced composer
 * files, optionally anchoring EGOV1 metadata in the same batch:
 *
 *   1. preimage.notePreimage(<call bytes>)               - Lookup proposals only
 *   2. referenda.submit(<origin>, Inline | Lookup, <enactment>)
 *   3. preimage.notePreimage(EGOV1:{"u":"<json url>","h":"<sha256>"})
 *   4. referenda.setMetadata(<index>, blake2_256(envelope bytes))
 *
 * Steps 3-4 are present only when `metadata` is given. Calls of up to
 * INLINE_PROPOSAL_MAX_BYTES ride inline (no preimage deposit, no step 1);
 * anything larger is noted and referenced by Lookup. `skipNote` drops step 1
 * when the same call bytes are already noted on chain by an account
 * (`Unrequested`) - notePreimage would otherwise abort with
 * `preimage.AlreadyNoted` and revert the whole batch. A `Requested` preimage
 * takes the note, and may not hold the bytes yet, so it must keep step 1.
 *
 * Same index + ordering contract as `buildTreasuryProposal`:
 * `referendumIndex` is `referenda.referendumCount()` read just before
 * building. If another submission lands first the index is stale,
 * setMetadata fails the runtime's depositor check (NoPermission), and the
 * batch reverts - a stale index can never annotate someone else's
 * referendum. It can annotate the same account's own earlier referendum,
 * which the caller detects by comparing the Submitted index with
 * `referendumIndex`. setMetadata needs both the referendum (step 2) and the
 * envelope preimage (step 3) to exist, so it comes last.
 */

import type { ApiPromise } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { ISubmittableResult } from "@polkadot/types/types"
import { stringToU8a } from "@polkadot/util"
import { canInline, hashCall, noteAndHash } from "./preimage"
import { buildSetMetadata, buildSubmit } from "./referenda"

type AnyExtrinsic = SubmittableExtrinsic<"promise", ISubmittableResult>

type BuildProposalSubmissionArgs = {
  /** Encoded bytes of the call the referendum will enact. */
  callBytes: Uint8Array
  /** Pallet origin to submit under, e.g. { System: "Root" }. */
  origin: unknown
  enactment: { type: "At" | "After"; block: number }
  /** The call bytes are already noted on chain - omit their notePreimage. */
  skipNote?: boolean
  /** EGOV1 envelope + the index it binds to. Omit to submit without metadata. */
  metadata?: {
    /** UTF-8 string produced by buildRemarkPayload(jsonUrl, sha256). */
    remarkPayload: string
    referendumIndex: number
  }
}

type BuiltProposalSubmission = {
  /** blake2-256 of the call bytes: the Lookup hash, or the inline call's hash. */
  callHash: `0x${string}`
  callLen: number
  /** True when the call rides inline in referenda.submit. */
  inline: boolean
  /** blake2-256 of the envelope bytes - what setMetadata binds. Null without metadata. */
  metadataHash: `0x${string}` | null
  /** Batch members in order; the caller wraps them in utility.batchAll. */
  calls: AnyExtrinsic[]
}

export function buildProposalSubmission(
  api: ApiPromise,
  args: BuildProposalSubmissionArgs,
): BuiltProposalSubmission {
  const inline = canInline(args.callBytes)
  const callHash = hashCall(args.callBytes)
  const calls: AnyExtrinsic[] = []

  if (!inline && !args.skipNote) {
    calls.push(noteAndHash(api, args.callBytes).extrinsic)
  }
  calls.push(
    buildSubmit(api, {
      origin: args.origin,
      proposal: inline
        ? { inline: args.callBytes }
        : { hash: callHash, len: args.callBytes.length },
      enactment: args.enactment,
    }) as AnyExtrinsic,
  )

  let metadataHash: `0x${string}` | null = null
  if (args.metadata) {
    // The envelope is noted as its own preimage, and setMetadata binds its
    // blake2-256 - NOT the sha256 inside it, which commits to the JSON.
    const { extrinsic: metadataNoteTx, hash } = noteAndHash(
      api,
      stringToU8a(args.metadata.remarkPayload),
    )
    metadataHash = hash
    calls.push(metadataNoteTx, buildSetMetadata(api, args.metadata.referendumIndex, hash))
  }

  return { callHash, callLen: args.callBytes.length, inline, metadataHash, calls }
}

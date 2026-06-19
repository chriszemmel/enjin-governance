/**
 * Helpers around api.tx.preimage + api.query.preimage.
 *
 * Workflow for submitting a referendum:
 *   1. Build the call you want to enact (e.g. treasury.spend(...)).
 *   2. Call `noteAndHash(api, call.method.toU8a())` to get the extrinsic
 *      that registers the bytes, plus the hash + len you'll pass as the
 *      `proposal` arg to referenda.submit.
 *   3. Submit the preimage extrinsic and the referenda.submit extrinsic
 *      as a utility.batchAll so they either both apply or both revert.
 */

import type { ApiPromise } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { ISubmittableResult } from "@polkadot/types/types"
import { blake2AsU8a, blake2AsHex } from "@polkadot/util-crypto"
import { u8aToHex } from "@polkadot/util"
import type { Preimage, PreimageRef, PreimageStatus } from "./types"

export type NotedPreimage = {
  extrinsic: SubmittableExtrinsic<"promise", ISubmittableResult>
  hash: `0x${string}`
  len: number
}

/**
 * Substrate encodes an `Bounded::Inline` proposal as a
 * `BoundedVec<u8, ConstU32<128>>`, so a call must be ≤ 128 bytes to ride
 * inline; anything larger MUST be noted as a preimage and referenced by
 * Lookup. A treasury `spend_local` is well under this, so it can go inline
 * and skip the preimage deposit + extra batch member.
 */
export const INLINE_PROPOSAL_MAX_BYTES = 128

/** True if `callBytes` is small enough to submit inline rather than as a preimage. */
export function canInline(
  callBytes: Uint8Array,
  max: number = INLINE_PROPOSAL_MAX_BYTES,
): boolean {
  return callBytes.length <= max
}

/**
 * Hash the call bytes blake2-256 (the on-chain hashing scheme), build the
 * preimage.notePreimage extrinsic, and return the lookup info the caller
 * will pass to referenda.submit.
 */
export function noteAndHash(api: ApiPromise, callBytes: Uint8Array): NotedPreimage {
  const hash = blake2AsHex(callBytes, 256) as `0x${string}`
  const extrinsic = api.tx.preimage.notePreimage(
    u8aToHex(callBytes),
  ) as SubmittableExtrinsic<"promise", ISubmittableResult>
  return { extrinsic, hash, len: callBytes.length }
}

export function buildUnnotePreimage(
  api: ApiPromise,
  hash: `0x${string}`,
): SubmittableExtrinsic<"promise", ISubmittableResult> {
  return api.tx.preimage.unnotePreimage(hash) as SubmittableExtrinsic<
    "promise",
    ISubmittableResult
  >
}

/**
 * Read a preimage's bytes by (hash, len). Returns null if the preimage isn't
 * stored. The bytes can then be decoded back to a Call with
 * `api.createType("Call", bytes)`.
 *
 * Falls through several lookup strategies - old referenda from the
 * `Legacy` proposal variant decode with `len = 0`, but the preimage on
 * chain is keyed by `(hash, real_len)`. We recover the real length from
 * the request-status row when needed, and as a last resort scan the
 * preimage map's keys for an entry whose hash matches ours.
 */
export async function getPreimage(
  api: ApiPromise,
  ref: PreimageRef,
): Promise<Preimage | null> {
  const status = await getPreimageStatus(api, ref.hash)

  // Strategy 1: direct lookup with the len we were given. Cheap when correct.
  // NB: preimage.preimageFor stores a `Bytes` codec - its `.toU8a()` includes
  // a compact length prefix. Pass `isBare = true` so we get just the raw
  // call bytes, otherwise `api.createType("Call", …)` decodes the length
  // prefix as the pallet index and produces empty section/method.
  const tryLen = async (len: number) => {
    const raw = await api.query.preimage.preimageFor([ref.hash, len])
    const opt = raw as unknown as {
      isSome: boolean
      unwrap: () => { toU8a: (isBare?: boolean) => Uint8Array }
    }
    return opt.isSome ? opt.unwrap().toU8a(true) : null
  }

  let bytes = ref.len > 0 ? await tryLen(ref.len) : null

  // Strategy 2: recover the len from the request-status entry. The
  // OpenGov pallet stores it as `Requested { maybe_len, .. }` or as
  // `Unrequested { len, .. }` depending on the variant.
  if (!bytes) {
    const lenFromStatus = await getLenFromStatus(api, ref.hash)
    if (lenFromStatus != null && lenFromStatus !== ref.len) {
      bytes = await tryLen(lenFromStatus)
      if (bytes) {
        return { hash: ref.hash, len: lenFromStatus, status, bytes }
      }
    }
  }

  // Strategy 3: scan preimageFor keys for a tuple that begins with this
  // hash. Bounded by the size of the on-chain preimage map (a few hundred
  // entries at most). Run only when the first two strategies miss.
  if (!bytes) {
    const len = await findLenByScanning(api, ref.hash)
    if (len != null) {
      bytes = await tryLen(len)
      if (bytes) {
        return { hash: ref.hash, len, status, bytes }
      }
    }
  }

  if (!bytes) {
    return { hash: ref.hash, len: ref.len, status, bytes: null }
  }
  return { hash: ref.hash, len: ref.len, status, bytes }
}

/**
 * Pull `len` out of the preimage's request-status row. Works for both
 * Requested (`maybe_len: Option<u32>`) and Unrequested (`len: u32`)
 * variants. Returns null if the status row doesn't exist or doesn't
 * carry a length.
 */
async function getLenFromStatus(
  api: ApiPromise,
  hash: `0x${string}`,
): Promise<number | null> {
  try {
    const raw = await api.query.preimage.requestStatusFor(hash)
    const opt = raw as unknown as {
      isSome: boolean
      unwrap: () => Record<string, unknown>
    }
    if (!opt.isSome) return null
    const status = opt.unwrap()
    if (status.isRequested) {
      const inner = status.asRequested as Record<string, unknown>
      const maybeLen = inner.maybeLen as
        | { isSome: boolean; unwrap: () => { toNumber: () => number } }
        | undefined
      if (maybeLen?.isSome) return maybeLen.unwrap().toNumber()
      // Older runtime: the variant carries `len: u32` directly.
      const len = inner.len as { toNumber: () => number } | undefined
      if (len?.toNumber) return len.toNumber()
    }
    if (status.isUnrequested) {
      const inner = status.asUnrequested as Record<string, unknown>
      const len = inner.len as { toNumber: () => number } | undefined
      if (len?.toNumber) return len.toNumber()
    }
  } catch {
    // Older `preimage` pallet exposes `statusFor` rather than
    // `requestStatusFor`. Fall through to scanning.
  }
  return null
}

/**
 * Walk preimageFor's keys, returning the `len` for the first entry whose
 * hash matches. Only called as a last resort; entries() is heavier than
 * a direct read, but the preimage map is small.
 */
async function findLenByScanning(
  api: ApiPromise,
  hash: `0x${string}`,
): Promise<number | null> {
  try {
    const keys = await api.query.preimage.preimageFor.keys()
    for (const key of keys) {
      const tuple = key.args[0] as unknown as {
        toJSON: () => [string, number]
      } | undefined
      if (!tuple) continue
      const [h, len] = tuple.toJSON()
      if (typeof h === "string" && h.toLowerCase() === hash.toLowerCase()) {
        return typeof len === "number" ? len : Number(len)
      }
    }
  } catch {
    /* swallow - best-effort */
  }
  return null
}

export async function getPreimageStatus(
  api: ApiPromise,
  hash: `0x${string}`,
): Promise<PreimageStatus> {
  const raw = await api.query.preimage.requestStatusFor(hash)
  const opt = raw as unknown as { isSome: boolean; unwrap: () => Record<string, unknown> }
  if (!opt.isSome) return "Missing"
  const status = opt.unwrap()
  if (status.isRequested) return "Requested"
  if (status.isUnrequested) return "Unrequested"
  return "Missing"
}

/**
 * Hash a byte array exactly the way the chain hashes preimages (blake2-256).
 * Exported so callers can pre-compute a hash without building the extrinsic.
 */
export function hashCall(callBytes: Uint8Array): `0x${string}` {
  return u8aToHex(blake2AsU8a(callBytes, 256)) as `0x${string}`
}

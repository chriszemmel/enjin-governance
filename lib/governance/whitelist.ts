/**
 * The fast track: the Fellowship whitelists one exact call by its hash
 * (`whitelist.whitelistCall`, from a fellowship referendum), and a public
 * referendum on the WhitelistedCaller track may then dispatch exactly that
 * call as Root (`whitelist.dispatchWhitelistedCall*`). Dispatching uses the
 * entry up; dispatching a call that isn't whitelisted fails with
 * `CallIsNotWhitelisted`.
 */

import type { ApiPromise } from "@polkadot/api"
import type { Call } from "@polkadot/types/interfaces"
import { u8aToHex } from "@polkadot/util"
import { blake2AsU8a } from "@polkadot/util-crypto"
import { getPreimage } from "./preimage"
import { getDecidedTrack, getReferendumHistory, listReferenda, type ReferendaPallet } from "./referenda"
import type { OngoingStatus, ReferendumStatusType } from "./types"

export type WhitelistRole =
  /** A fellowship referendum's call that whitelists `hash`. */
  | { role: "whitelist"; hash: `0x${string}` }
  /** A public referendum's call that dispatches the whitelisted `hash`. */
  | { role: "dispatch"; hash: `0x${string}`; inner: Call | null }

/** Where a call stands in the fast track, from its encoded bytes. */
export function whitelistRoleOf(api: ApiPromise, bytes: Uint8Array | null | undefined): WhitelistRole | null {
  if (!bytes || bytes.length < 2) return null
  let call: Call
  try {
    call = api.createType("Call", bytes) as unknown as Call
  } catch {
    return null
  }
  return whitelistRoleOfCall(call)
}

export function whitelistRoleOfCall(call: Call): WhitelistRole | null {
  if (call.section !== "whitelist") return null
  if (call.method === "whitelistCall") {
    return { role: "whitelist", hash: call.args[0]!.toHex() as `0x${string}` }
  }
  if (call.method === "dispatchWhitelistedCall") {
    return { role: "dispatch", hash: call.args[0]!.toHex() as `0x${string}`, inner: null }
  }
  if (call.method === "dispatchWhitelistedCallWithPreimage") {
    const inner = call.args[0] as unknown as Call
    return { role: "dispatch", hash: callHash(inner.toU8a()), inner }
  }
  return null
}

/** The whitelist's key for a call: blake2-256 of its encoding. */
export function callHash(encoded: Uint8Array): `0x${string}` {
  return u8aToHex(blake2AsU8a(encoded, 256)) as `0x${string}`
}

/** Whether `hash` is whitelisted right now. */
export async function isWhitelisted(api: ApiPromise, hash: `0x${string}`): Promise<boolean> {
  const entry = await api.query.whitelist!.whitelistedCall!(hash)
  return (entry as unknown as { isSome: boolean }).isSome
}

/** One side of the fast track, found by its call's hash. */
export type WhitelistCounterpart = {
  pallet: ReferendaPallet
  index: number
  status: ReferendumStatusType
}

/** The call bytes of a referendum's proposal, inline or from its preimage. */
async function proposalBytes(
  api: ApiPromise,
  proposal: OngoingStatus["proposal"],
): Promise<Uint8Array | null> {
  if ("type" in proposal) return proposal.bytes
  return (await getPreimage(api, proposal))?.bytes ?? null
}

/**
 * The referenda on the other side of `hash`'s fast track: for a call that
 * whitelists it, the public referenda that dispatch it; for a dispatch,
 * the fellowship referenda that whitelist it. Decided referenda keep their
 * call only in history, read from `archive` at the block before the
 * decision; of the public ones only those on the WhitelistedCaller track
 * (`dispatchTrackId`), whose track `decidedTracks` (the cached tracks of
 * decided public referenda) or else a cheap raw read tells.
 */
export async function findCounterparts(
  api: ApiPromise,
  archive: ApiPromise | null,
  role: WhitelistRole,
  dispatchTrackId: number | null,
  decidedTracks: ReadonlyMap<number, number> = new Map(),
): Promise<WhitelistCounterpart[]> {
  const pallet: ReferendaPallet = role.role === "whitelist" ? "referenda" : "fellowshipReferenda"
  const want = role.role === "whitelist" ? "dispatch" : "whitelist"
  const referenda = await listReferenda(api, {}, pallet)
  const out: WhitelistCounterpart[] = []
  for (const ref of referenda) {
    let status: OngoingStatus | null = ref.status.type === "Ongoing" ? ref.status : null
    if (pallet === "referenda" && status && status.trackId !== dispatchTrackId) continue
    let source: ApiPromise = api
    if (!status && archive && ref.status.type !== "Killed" && "at" in ref.status) {
      if (pallet === "referenda") {
        if (dispatchTrackId == null) continue
        const track =
          decidedTracks.get(ref.index) ?? (await getDecidedTrack(archive, ref.index, ref.status.at))
        if (track !== dispatchTrackId) continue
      }
      const history = await getReferendumHistory(archive, ref.index, ref.status.at, pallet)
      status = history?.status.type === "Ongoing" ? history.status : null
      if (status) {
        const hash = await archive.rpc.chain.getBlockHash(ref.status.at - 1)
        source = (await archive.at(hash)) as unknown as ApiPromise
      }
    }
    if (!status) continue
    const found = whitelistRoleOf(api, await proposalBytes(source, status.proposal).catch(() => null))
    if (found?.role === want && found.hash === role.hash) {
      out.push({ pallet, index: ref.index, status: ref.status.type })
    }
  }
  return out
}

/** Every call hash whitelisted right now. */
export async function listWhitelisted(api: ApiPromise): Promise<`0x${string}`[]> {
  const entries = await api.query.whitelist!.whitelistedCall!.entries()
  return entries.map(([key]) => (key.args[0] as unknown as { toHex: () => string }).toHex() as `0x${string}`)
}

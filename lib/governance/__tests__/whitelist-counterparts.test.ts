import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import {
  findCounterparts,
  isWhitelisted,
  listWhitelisted,
  whitelistRoleOf,
  type WhitelistRole,
} from "@/lib/governance/whitelist"

/**
 * The fast-track lookups: which referenda sit on the other side of a call
 * hash. Proposals are inline bytes whose first byte picks a fake call:
 * 1 = whitelist.whitelistCall(H), 2 = whitelist.dispatchWhitelistedCall(H),
 * 3 = system.remark. `createType("Call", …)` maps those to call objects.
 */

const H = `0x${"cd".repeat(32)}` as const
const OTHER = `0x${"ef".repeat(32)}` as const
const DISPATCH_TRACK = 3

const asApi = (fake: object) => fake as unknown as ApiPromise
const num = (n: number) => ({ toNumber: () => n })
const big = (b: bigint) => ({ toBigInt: () => b, toString: () => b.toString() })
const some = (v: unknown) => ({ isSome: true, unwrap: () => v })
const none = () => ({ isSome: false, unwrap: () => undefined })

const WHITELIST = 1
const DISPATCH = 2
const REMARK = 3
const call = (kind: number, hash: string = H) => new Uint8Array([kind, hash === H ? 0 : 1])

function fakeCall(bytes: Uint8Array) {
  const hash = bytes[1] === 0 ? H : OTHER
  const arg = { toHex: () => hash }
  if (bytes[0] === WHITELIST) return { section: "whitelist", method: "whitelistCall", args: [arg] }
  if (bytes[0] === DISPATCH)
    return { section: "whitelist", method: "dispatchWhitelistedCall", args: [arg] }
  if (bytes[0] === REMARK) return { section: "system", method: "remark", args: [] }
  throw new Error("cannot decode")
}

function ongoing(track: number, bytes: Uint8Array) {
  return some({
    isOngoing: true,
    asOngoing: {
      track: num(track),
      origin: {},
      proposal: { isInline: true, asInline: { toU8a: () => bytes } },
      enactment: { isAfter: true, asAfter: num(0) },
      submitted: num(1),
      submissionDeposit: { who: { toString: () => "a" }, amount: big(1n) },
      decisionDeposit: none(),
      deciding: none(),
      tally: { ayes: big(0n), nays: big(0n), support: big(0n) },
      inQueue: { valueOf: () => false },
      alarm: none(),
    },
  })
}
const approved = (at: number) => some({ isApproved: true, asApproved: [num(at), none(), none()] })
const killed = (at: number) => some({ isKilled: true, asKilled: num(at) })

type Refs = Array<[number, unknown]>

function chain(opts: { referenda?: Refs; fellowshipReferenda?: Refs }) {
  const pallet = (refs: Refs = []) => ({
    referendumInfoFor: Object.assign(async () => none(), {
      entries: async () => refs.map(([i, info]) => [{ args: [num(i)] }, info]),
    }),
  })
  return asApi({
    createType: (_: string, bytes: Uint8Array) => fakeCall(bytes),
    query: {
      referenda: pallet(opts.referenda),
      fellowshipReferenda: pallet(opts.fellowshipReferenda),
    },
  })
}

/** An archive whose state before each decision holds `history[index]`. */
function archive(history: Record<number, { info: unknown; track: number }>) {
  return asApi({
    rpc: {
      chain: { getBlockHash: async (block: number) => `hash-${block}` },
      state: {
        getStorage: async (key: { index: number }) =>
          some({ toU8a: () => new Uint8Array([0, history[key.index]?.track ?? 255, 0]) }),
      },
    },
    query: { referenda: { referendumInfoFor: { key: (index: number) => ({ index }) } } },
    at: async () => ({
      query: {
        referenda: { referendumInfoFor: async (index: number) => history[index]?.info ?? none() },
        fellowshipReferenda: {
          referendumInfoFor: async (index: number) => history[index]?.info ?? none(),
        },
      },
    }),
  })
}

describe("whitelistRoleOf", () => {
  it("decodes the call's bytes, and is null for nothing or undecodable bytes", () => {
    const api = chain({})
    expect(whitelistRoleOf(api, call(WHITELIST))).toEqual({ role: "whitelist", hash: H })
    expect(whitelistRoleOf(api, new Uint8Array([9, 9]))).toBeNull()
    expect(whitelistRoleOf(api, new Uint8Array([1]))).toBeNull()
    expect(whitelistRoleOf(api, null)).toBeNull()
  })
})

describe("isWhitelisted / listWhitelisted", () => {
  it("reads the whitelist storage", async () => {
    const api = asApi({
      query: {
        whitelist: {
          whitelistedCall: Object.assign(async (hash: string) => ({ isSome: hash === H }), {
            entries: async () => [[{ args: [{ toHex: () => H }] }, {}]],
          }),
        },
      },
    })
    expect(await isWhitelisted(api, H)).toBe(true)
    expect(await isWhitelisted(api, OTHER)).toBe(false)
    expect(await listWhitelisted(api)).toEqual([H])
  })
})

describe("findCounterparts", () => {
  const whitelisting: WhitelistRole = { role: "whitelist", hash: H }
  const dispatching: WhitelistRole = { role: "dispatch", hash: H, inner: null }

  it("finds the ongoing public referenda on the dispatch track that dispatch the hash", async () => {
    const api = chain({
      referenda: [
        [10, ongoing(DISPATCH_TRACK, call(DISPATCH))],
        [11, ongoing(DISPATCH_TRACK, call(DISPATCH, OTHER))], // another hash
        [12, ongoing(0, call(DISPATCH))], // wrong track
        [13, ongoing(DISPATCH_TRACK, call(REMARK))], // not a dispatch
      ],
    })
    expect(await findCounterparts(api, null, whitelisting, DISPATCH_TRACK)).toEqual([
      { pallet: "referenda", index: 10, status: "Ongoing" },
    ])
  })

  it("finds the fellowship referenda that whitelist a dispatched hash", async () => {
    const api = chain({
      fellowshipReferenda: [
        [1, ongoing(3, call(WHITELIST))],
        [2, ongoing(3, call(DISPATCH))],
      ],
    })
    expect(await findCounterparts(api, null, dispatching, DISPATCH_TRACK)).toEqual([
      { pallet: "fellowshipReferenda", index: 1, status: "Ongoing" },
    ])
  })

  it("reads decided referenda from the archive, on the dispatch track only", async () => {
    const api = chain({
      referenda: [
        [20, approved(1_000)], // on the dispatch track, read from history
        [21, approved(2_000)], // track from the cache: not the dispatch track
        [22, approved(3_000)], // raw read says another track
        [23, killed(4_000)], // killed referenda keep nothing
        [24, approved(5_000)], // history pruned
      ],
    })
    const arch = archive({
      20: { info: ongoing(DISPATCH_TRACK, call(DISPATCH)), track: DISPATCH_TRACK },
      22: { info: ongoing(0, call(DISPATCH)), track: 0 },
      24: { info: none(), track: DISPATCH_TRACK },
    })
    const cache = new Map([[21, 0]])
    expect(await findCounterparts(api, arch, whitelisting, DISPATCH_TRACK, cache)).toEqual([
      { pallet: "referenda", index: 20, status: "Approved" },
    ])
  })

  it("skips decided public referenda when the dispatch track is unknown", async () => {
    const api = chain({ referenda: [[20, approved(1_000)]] })
    const arch = archive({
      20: { info: ongoing(DISPATCH_TRACK, call(DISPATCH)), track: DISPATCH_TRACK },
    })
    expect(await findCounterparts(api, arch, whitelisting, null)).toEqual([])
  })

  it("reads decided fellowship referenda from history without a track check", async () => {
    const api = chain({ fellowshipReferenda: [[5, approved(700)]] })
    const arch = archive({ 5: { info: ongoing(7, call(WHITELIST)), track: 7 } })
    expect(await findCounterparts(api, arch, dispatching, null)).toEqual([
      { pallet: "fellowshipReferenda", index: 5, status: "Approved" },
    ])
  })
})

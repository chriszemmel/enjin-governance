import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import {
  buildDelegate,
  buildRemoveVote,
  buildUndelegate,
  buildUnlock,
  buildVote,
  getAccountLocks,
  getClassLocks,
  getDelegationsFor,
  getMyVotesOnPoll,
  getMyVotesOnPollAnyTrack,
  sEnjCurrency,
} from "@/lib/governance/conviction-voting"

/**
 * These tests exercise the runtime-detection logic that picks the right
 * pallet (voteManager vs convictionVoting) and arity (2 vs 3 args incl.
 * currency), plus the multi-currency vote decode + weight sort. We build
 * a fake `api.tx` that records the calls it receives, following the
 * plain-object-fake convention in lib/chain/__tests__/events.test.ts.
 */

type Recorded = { call: string; args: unknown[] }

/** An extrinsic-factory fn carrying `.meta.args.length` for arity probing. */
function txFn(name: string, argCount: number, sink: Recorded[]) {
  return Object.assign(
    (...args: unknown[]) => {
      sink.push({ call: name, args })
      return { __tx: name } as unknown
    },
    { meta: { args: { length: argCount } } },
  )
}

describe("sEnjCurrency", () => {
  it("wraps the pool id in the { SEnj: { tokenId } } struct the runtime expects", () => {
    // A flat { SEnj: 7 } fails codec decoding; the struct form is required.
    expect(sEnjCurrency(7)).toEqual({ SEnj: { tokenId: 7 } })
  })
})

describe("buildVote - pallet + arity routing", () => {
  const params = {
    pollIndex: 3,
    aye: true,
    balance: 100n,
    conviction: "Locked1x" as const,
  }
  const expectedAccountVote = {
    Standard: { vote: { aye: true, conviction: "Locked1x" }, balance: "100" },
  }

  it("routes to voteManager.vote with the default ENJ currency", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { voteManager: { vote: txFn("voteManager.vote", 3, sink) } },
    } as unknown as ApiPromise
    buildVote(api, params)
    expect(sink).toHaveLength(1)
    expect(sink[0].call).toBe("voteManager.vote")
    expect(sink[0].args).toEqual([3, expectedAccountVote, { Enj: null }])
  })

  it("passes an explicit sENJ currency through to voteManager", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { voteManager: { vote: txFn("voteManager.vote", 3, sink) } },
    } as unknown as ApiPromise
    buildVote(api, { ...params, currency: sEnjCurrency(9) })
    expect(sink[0].args).toEqual([3, expectedAccountVote, { SEnj: { tokenId: 9 } }])
  })

  it("uses 2-arg convictionVoting.vote on stock Substrate (no currency)", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { vote: txFn("convictionVoting.vote", 2, sink) } },
    } as unknown as ApiPromise
    buildVote(api, params)
    expect(sink[0].call).toBe("convictionVoting.vote")
    expect(sink[0].args).toEqual([3, expectedAccountVote])
  })

  it("uses 3-arg convictionVoting.vote on the multi-token canary runtime", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { vote: txFn("convictionVoting.vote", 3, sink) } },
    } as unknown as ApiPromise
    buildVote(api, params)
    expect(sink[0].args).toEqual([3, expectedAccountVote, { Enj: null }])
  })
})

describe("buildRemoveVote - arity routing", () => {
  it("uses 3-arg voteManager.removeVote when the metadata declares 3 args", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { voteManager: { removeVote: txFn("voteManager.removeVote", 3, sink) } },
    } as unknown as ApiPromise
    buildRemoveVote(api, 2, 3)
    expect(sink[0].args).toEqual([2, 3, { Enj: null }])
  })

  it("uses 2-arg convictionVoting.removeVote on stock Substrate", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { removeVote: txFn("convictionVoting.removeVote", 2, sink) } },
    } as unknown as ApiPromise
    buildRemoveVote(api, 2, 3)
    expect(sink[0].args).toEqual([2, 3])
  })
})

describe("buildDelegate - arity routing", () => {
  const params = {
    trackId: 1,
    to: "enBob",
    conviction: "Locked3x" as const,
    balance: 500n,
  }

  it("uses 5-arg voteManager.delegate (with currency) when metadata declares 5", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { voteManager: { delegate: txFn("voteManager.delegate", 5, sink) } },
    } as unknown as ApiPromise
    buildDelegate(api, params)
    expect(sink[0].call).toBe("voteManager.delegate")
    expect(sink[0].args).toEqual([1, "enBob", "Locked3x", "500", { Enj: null }])
  })

  it("passes an explicit sENJ currency into the 5-arg voteManager.delegate", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { voteManager: { delegate: txFn("voteManager.delegate", 5, sink) } },
    } as unknown as ApiPromise
    buildDelegate(api, { ...params, currency: sEnjCurrency(4) })
    expect(sink[0].args).toEqual([1, "enBob", "Locked3x", "500", { SEnj: { tokenId: 4 } }])
  })

  it("drops the currency arg when voteManager.delegate declares only 4 args", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { voteManager: { delegate: txFn("voteManager.delegate", 4, sink) } },
    } as unknown as ApiPromise
    buildDelegate(api, params)
    expect(sink[0].args).toEqual([1, "enBob", "Locked3x", "500"])
  })

  it("uses 4-arg convictionVoting.delegate on stock Substrate (no currency)", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { delegate: txFn("convictionVoting.delegate", 4, sink) } },
    } as unknown as ApiPromise
    buildDelegate(api, params)
    expect(sink[0].call).toBe("convictionVoting.delegate")
    expect(sink[0].args).toEqual([1, "enBob", "Locked3x", "500"])
  })

  it("uses 5-arg convictionVoting.delegate on the multi-token canary runtime", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { delegate: txFn("convictionVoting.delegate", 5, sink) } },
    } as unknown as ApiPromise
    buildDelegate(api, params)
    expect(sink[0].args).toEqual([1, "enBob", "Locked3x", "500", { Enj: null }])
  })
})

describe("buildUndelegate - arity routing", () => {
  it("uses 2-arg convictionVoting.undelegate (with currency) on the Enjin runtime", () => {
    // Confirmed against enjin v1070: undelegate(class, currency).
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { undelegate: txFn("convictionVoting.undelegate", 2, sink) } },
    } as unknown as ApiPromise
    buildUndelegate(api, 7)
    expect(sink[0].call).toBe("convictionVoting.undelegate")
    expect(sink[0].args).toEqual([7, { Enj: null }])
  })

  it("drops currency on stock 1-arg convictionVoting.undelegate", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { undelegate: txFn("convictionVoting.undelegate", 1, sink) } },
    } as unknown as ApiPromise
    buildUndelegate(api, 7)
    expect(sink[0].args).toEqual([7])
  })

  it("routes to a 2-arg voteManager.undelegate when that pallet exists", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { voteManager: { undelegate: txFn("voteManager.undelegate", 2, sink) } },
    } as unknown as ApiPromise
    buildUndelegate(api, 7, sEnjCurrency(3))
    expect(sink[0].args).toEqual([7, { SEnj: { tokenId: 3 } }])
  })
})

describe("buildUnlock - arity routing", () => {
  it("uses 3-arg convictionVoting.unlock (class, target, currency) on the Enjin runtime", () => {
    // Confirmed against enjin v1070: unlock(class, target, currency).
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { unlock: txFn("convictionVoting.unlock", 3, sink) } },
    } as unknown as ApiPromise
    buildUnlock(api, 2, "enAlice")
    expect(sink[0].args).toEqual([2, "enAlice", { Enj: null }])
  })

  it("passes an explicit sENJ currency through to unlock", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { unlock: txFn("convictionVoting.unlock", 3, sink) } },
    } as unknown as ApiPromise
    buildUnlock(api, 2, "enAlice", sEnjCurrency(5))
    expect(sink[0].args).toEqual([2, "enAlice", { SEnj: { tokenId: 5 } }])
  })

  it("drops currency on stock 2-arg convictionVoting.unlock", () => {
    const sink: Recorded[] = []
    const api = {
      tx: { convictionVoting: { unlock: txFn("convictionVoting.unlock", 2, sink) } },
    } as unknown as ApiPromise
    buildUnlock(api, 2, "enAlice")
    expect(sink[0].args).toEqual([2, "enAlice"])
  })
})

/* ----- getMyVotesOnPoll: multi-currency decode + weight sort ----- */

const num = (n: number) => ({ toNumber: () => n }) as unknown
const big = (b: bigint) => ({ toBigInt: () => b, toString: () => b.toString() }) as unknown

/** A Casting voting record holding one Standard vote on `pollIndex`. */
function castingValue(pollIndex: number, aye: boolean, conviction: string, balance: bigint) {
  return {
    isCasting: true,
    asCasting: {
      votes: [
        [
          num(pollIndex),
          {
            isStandard: true,
            asStandard: {
              vote: { isAye: aye, conviction: { type: conviction } },
              balance: big(balance),
            },
          },
        ],
      ],
    },
  }
}

/** An NMap entry key whose 3rd arg carries the currency JSON. */
function entryKey(addr: string, trackId: number, currency: unknown) {
  return {
    args: [{ toString: () => addr }, num(trackId), { toJSON: () => currency }],
  }
}

describe("getMyVotesOnPoll - multi-currency decode + weight sort", () => {
  it("returns one entry per currency, decoded, sorted by voting weight desc", async () => {
    const entries = [
      // sENJ Locked1x: weight = 100 * (1 * 10) = 1000
      [entryKey("addr", 2, { SEnj: { tokenId: 7 } }), castingValue(5, true, "Locked1x", 100n)],
      // ENJ Locked6x: weight = 100 * (6 * 10) = 6000  -> should sort first
      [entryKey("addr", 2, { Enj: null }), castingValue(5, false, "Locked6x", 100n)],
    ]
    const api = {
      query: {
        convictionVoting: {
          votingFor: Object.assign(
            async () => undefined,
            { entries: async () => entries },
          ),
        },
      },
    } as unknown as ApiPromise

    const result = await getMyVotesOnPoll(api, "addr", 2, 5)
    expect(result).toHaveLength(2)
    // Heaviest (ENJ Locked6x) first.
    expect(result[0].currencyRaw).toEqual({ Enj: null })
    expect(result[0].vote).toMatchObject({
      type: "Standard",
      pollIndex: 5,
      trackId: 2,
      aye: false,
      balance: 100n,
      conviction: "Locked6x",
    })
    expect(result[1].currencyRaw).toEqual({ SEnj: { tokenId: 7 } })
    expect(result[1].vote).toMatchObject({ conviction: "Locked1x", balance: 100n })
  })

  it("filters out votes cast on other polls", async () => {
    const entries = [
      [entryKey("addr", 2, { Enj: null }), castingValue(99, true, "Locked1x", 50n)],
    ]
    const api = {
      query: {
        convictionVoting: {
          votingFor: Object.assign(
            async () => undefined,
            { entries: async () => entries },
          ),
        },
      },
    } as unknown as ApiPromise
    expect(await getMyVotesOnPoll(api, "addr", 2, 5)).toEqual([])
  })

  it("returns [] when the runtime exposes no voting storage", async () => {
    const api = { query: {} } as unknown as ApiPromise
    expect(await getMyVotesOnPoll(api, "addr", 2, 5)).toEqual([])
  })
})

describe("getMyVotesOnPollAnyTrack - trackId recovery (terminal referenda)", () => {
  it("recovers trackId from the storage key and filters to the poll", async () => {
    const entries = [
      [entryKey("addr", 5, { Enj: null }), castingValue(10, true, "Locked2x", 100n)],
      [entryKey("addr", 9, { Enj: null }), castingValue(10, false, "Locked1x", 50n)],
      // a vote on a different poll on yet another track - must be excluded
      [entryKey("addr", 3, { Enj: null }), castingValue(99, true, "Locked1x", 10n)],
    ]
    const api = {
      query: {
        convictionVoting: {
          votingFor: Object.assign(async () => undefined, {
            entries: async () => entries,
          }),
        },
      },
    } as unknown as ApiPromise

    const result = await getMyVotesOnPollAnyTrack(api, "addr", 10)
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.vote.pollIndex === 10)).toBe(true)
    // trackId recovered from the key, not passed in.
    expect(result.map((r) => r.vote.trackId).sort()).toEqual([5, 9])
    // sorted by weight desc: track 5 Locked2x (100*20=2000) before track 9 (50*10=500)
    expect(result[0].vote.trackId).toBe(5)
  })

  it("returns [] when the runtime exposes no voting storage", async () => {
    const api = { query: {} } as unknown as ApiPromise
    expect(await getMyVotesOnPollAnyTrack(api, "addr", 10)).toEqual([])
  })
})

/** A (account, currency) classLocksFor entry key: args[1] carries currency. */
function classLockKey(addr: string, currency: unknown) {
  return { args: [{ toString: () => addr }, { toJSON: () => currency }] }
}

describe("getAccountLocks - per-currency locks", () => {
  it("surfaces an ENJ lock AND an sENJ lock on the same track as two rows", async () => {
    const api = {
      query: {
        convictionVoting: {
          classLocksFor: Object.assign(async () => [], {
            entries: async () => [
              [classLockKey("addr", { Enj: null }), [[num(2), big(1n)]]],
              [classLockKey("addr", { SEnj: { tokenId: 7 } }), [[num(2), big(5n)]]],
            ],
          }),
          votingFor: Object.assign(async () => undefined, {
            entries: async () => [
              [entryKey("addr", 2, { Enj: null }), castingValue(5, true, "Locked1x", 1n)],
              [
                entryKey("addr", 2, { SEnj: { tokenId: 7 } }),
                castingValue(5, true, "Locked2x", 5n),
              ],
            ],
          }),
        },
      },
    } as unknown as ApiPromise

    const locks = await getAccountLocks(api, "addr")
    expect(locks).toHaveLength(2)

    const enj = locks.find((l) => (l.currencyRaw as { Enj?: unknown }).Enj === null)
    const senj = locks.find((l) => (l.currencyRaw as { SEnj?: unknown }).SEnj != null)

    // ENJ lock: 1 planck, and its "held by" list only sees the 1-planck ENJ vote.
    expect(enj?.locked).toBe(1n)
    expect(enj?.activeVotes).toHaveLength(1)
    expect(enj?.activeVotes[0]).toMatchObject({ balance: 1n, conviction: "Locked1x" })

    // sENJ lock: 5 planck, and it only claims the 5-planck sENJ vote - not the
    // ENJ one. Each currency's lock stands on its own.
    expect(senj?.locked).toBe(5n)
    expect(senj?.activeVotes).toHaveLength(1)
    expect(senj?.activeVotes[0]).toMatchObject({ balance: 5n, conviction: "Locked2x" })
  })

  it("falls back to the stock single-key classLocksFor (currencyRaw null)", async () => {
    const api = {
      query: {
        convictionVoting: {
          classLocksFor: Object.assign(
            async (_addr: string) => [[num(3), big(9n)]],
            {
              entries: async () => {
                throw new Error("single-key map has no prefix entries")
              },
            },
          ),
          votingFor: Object.assign(async () => undefined, {
            entries: async () => {
              throw new Error("double-map only")
            },
          }),
        },
      },
    } as unknown as ApiPromise

    const locks = await getAccountLocks(api, "addr")
    expect(locks).toEqual([
      { trackId: 3, locked: 9n, prior: null, activeVotes: [], currencyRaw: null },
    ])
  })
})

describe("getClassLocks - multi-token classLocksFor", () => {
  const votingForStub = Object.assign(async () => undefined, {
    entries: async () => [],
  })

  it("reads the 2-key (account, currency) map on the Enjin fork", async () => {
    const api = {
      query: {
        convictionVoting: {
          votingFor: votingForStub,
          classLocksFor: async (_addr: string, currency?: unknown) => {
            if (currency === undefined) throw new Error("Expected 2 arguments")
            return [[num(2), big(10n)]]
          },
        },
      },
    } as unknown as ApiPromise
    expect(await getClassLocks(api, "addr")).toEqual([{ trackId: 2, amount: 10n }])
  })

  it("falls back to the 1-key map on stock Substrate", async () => {
    const api = {
      query: {
        convictionVoting: {
          votingFor: votingForStub,
          classLocksFor: async (_addr: string, currency?: unknown) => {
            if (currency !== undefined) throw new Error("Expected 1 argument")
            return [[num(5), big(7n)]]
          },
        },
      },
    } as unknown as ApiPromise
    expect(await getClassLocks(api, "addr")).toEqual([{ trackId: 5, amount: 7n }])
  })

  it("returns [] when classLocksFor is absent", async () => {
    const api = {
      query: { convictionVoting: { votingFor: votingForStub } },
    } as unknown as ApiPromise
    expect(await getClassLocks(api, "addr")).toEqual([])
  })
})

function delegatingValue(target: string, balance: bigint, conviction: string) {
  return {
    isDelegating: true,
    asDelegating: {
      target: { toString: () => target },
      balance: big(balance),
      conviction: { type: conviction },
    },
  }
}

describe("getDelegationsFor", () => {
  it("decodes Delegating rows (per track + currency) and skips Casting", async () => {
    const entries = [
      [entryKey("me", 2, { Enj: null }), delegatingValue("enBob", 100n, "Locked3x")],
      [entryKey("me", 5, { SEnj: { tokenId: 7 } }), delegatingValue("enBob", 50n, "Locked1x")],
      // a Casting row on another track must be ignored
      [entryKey("me", 9, { Enj: null }), castingValue(1, true, "Locked1x", 10n)],
    ]
    const api = {
      query: {
        convictionVoting: {
          votingFor: Object.assign(async () => undefined, {
            entries: async () => entries,
          }),
        },
      },
    } as unknown as ApiPromise

    const res = await getDelegationsFor(api, "me")
    expect(res).toHaveLength(2)
    expect(res[0]).toMatchObject({
      trackId: 2,
      target: "enBob",
      balance: 100n,
      conviction: "Locked3x",
    })
    expect(res[0].currencyRaw).toEqual({ Enj: null })
    expect(res[1]).toMatchObject({ trackId: 5, balance: 50n, conviction: "Locked1x" })
    expect(res[1].currencyRaw).toEqual({ SEnj: { tokenId: 7 } })
  })

  it("returns [] when the runtime exposes no voting storage", async () => {
    const api = { query: {} } as unknown as ApiPromise
    expect(await getDelegationsFor(api, "me")).toEqual([])
  })
})

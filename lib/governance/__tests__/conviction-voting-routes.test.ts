import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import {
  buildRemoveVote,
  buildSplitAbstainVote,
  buildSplitVote,
  buildUndelegate,
  buildUnlock,
  buildVote,
  getAccountLocks,
  getClassLocks,
  getDelegationsFor,
  getMyVotesOnPoll,
  getMyVotesOnPollAnyTrack,
  getVotesFor,
  listVotesOnPoll,
  sEnjCurrency,
} from "@/lib/governance/conviction-voting"
import { defined } from "@/test/defined"

/**
 * The routes conviction-voting.test.ts leaves out: Split / SplitAbstain
 * votes, the voteManager arities of remove / unlock / undelegate, metadata
 * that can't be probed, the stock double-map fallbacks, the per-poll voter
 * list and the prior-lock / currency matching behind the locks panel.
 * Same plain-object fakes as the sibling file.
 */

type Recorded = { call: string; args: unknown[] }

function txFn(name: string, argCount: number, sink: Recorded[]) {
  return Object.assign(
    (...args: unknown[]) => {
      sink.push({ call: name, args })
      return { __tx: name }
    },
    { meta: { args: { length: argCount } } },
  )
}

/** An extrinsic whose metadata throws when read - arity can't be probed. */
function unprobeableTx(name: string, sink: Recorded[]) {
  const fn = (...args: unknown[]) => {
    sink.push({ call: name, args })
    return { __tx: name }
  }
  Object.defineProperty(fn, "meta", {
    get() {
      throw new Error("metadata unavailable")
    },
  })
  return fn
}

const asApi = (fake: object) => fake as unknown as ApiPromise
const only = (sink: Recorded[]) => {
  expect(sink).toHaveLength(1)
  return defined(sink[0], "recorded call")
}

const num = (n: number) => ({ toNumber: () => n })
const big = (b: bigint) => ({ toBigInt: () => b, toString: () => b.toString() })

type FakeVote =
  | { kind: "Standard"; poll: number; aye: boolean; conviction: string; balance: bigint }
  | { kind: "Split"; poll: number; aye: bigint; nay: bigint }
  | { kind: "SplitAbstain"; poll: number; aye: bigint; nay: bigint; abstain: bigint }

function accountVote(v: FakeVote) {
  if (v.kind === "Standard") {
    return {
      isStandard: true,
      asStandard: {
        vote: { isAye: v.aye, conviction: { type: v.conviction } },
        balance: big(v.balance),
      },
    }
  }
  if (v.kind === "Split") {
    return { isSplit: true, asSplit: { aye: big(v.aye), nay: big(v.nay) } }
  }
  return {
    asSplitAbstain: { aye: big(v.aye), nay: big(v.nay), abstain: big(v.abstain) },
  }
}

function casting(votes: FakeVote[], prior?: [number, bigint]) {
  return {
    isCasting: true,
    asCasting: {
      votes: votes.map((v) => [num(v.poll), accountVote(v)]),
      prior: prior ? [num(prior[0]), big(prior[1])] : undefined,
    },
  }
}

const key = (...args: unknown[]) => ({ args })
const addrArg = (a: string) => ({ toString: () => a })
const jsonArg = (j: unknown) => ({ toJSON: () => j })

/** A storage map fake: callable, with `.entries()`. */
function storageMap(call: (...a: unknown[]) => unknown, entries: (...a: unknown[]) => unknown) {
  return Object.assign(async (...a: unknown[]) => call(...a), {
    entries: async (...a: unknown[]) => entries(...a),
  })
}
const throws = (msg: string) => () => {
  throw new Error(msg)
}

describe("buildSplitVote / buildSplitAbstainVote", () => {
  it("sends a Split vote as aye/nay planck strings with the ENJ currency", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { convictionVoting: { vote: txFn("cv.vote", 3, sink) } } })
    buildSplitVote(api, { pollIndex: 4, aye: 6_000n, nay: 4_000n })
    expect(only(sink).args).toEqual([4, { Split: { aye: "6000", nay: "4000" } }, { Enj: null }])
  })

  it("passes an sENJ currency through to a Split vote", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { convictionVoting: { vote: txFn("cv.vote", 3, sink) } } })
    buildSplitVote(api, { pollIndex: 4, aye: 1n, nay: 2n, currency: sEnjCurrency(3) })
    expect(only(sink).args[2]).toEqual({ SEnj: { tokenId: 3 } })
  })

  it("sends a SplitAbstain vote with all three amounts", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { convictionVoting: { vote: txFn("cv.vote", 2, sink) } } })
    buildSplitAbstainVote(api, { pollIndex: 9, aye: 1n, nay: 2n, abstain: 3n })
    expect(only(sink).args).toEqual([9, { SplitAbstain: { aye: "1", nay: "2", abstain: "3" } }])
  })

  it("routes a SplitAbstain vote to voteManager when the runtime has one", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { voteManager: { vote: txFn("vm.vote", 3, sink) } } })
    buildSplitAbstainVote(api, { pollIndex: 9, aye: 0n, nay: 0n, abstain: 5n })
    expect(only(sink)).toEqual({
      call: "vm.vote",
      args: [9, { SplitAbstain: { aye: "0", nay: "0", abstain: "5" } }, { Enj: null }],
    })
  })

  it("keeps amounts above 2^53 exact (no float rounding)", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { convictionVoting: { vote: txFn("cv.vote", 3, sink) } } })
    const huge = 12_345_678_901_234_567_890_123n
    buildSplitVote(api, { pollIndex: 1, aye: huge, nay: huge + 1n })
    expect(only(sink).args[1]).toEqual({
      Split: { aye: "12345678901234567890123", nay: "12345678901234567890124" },
    })
  })
})

describe("arity probing when the metadata can't be read", () => {
  it("falls back to the 2-arg vote (no currency) when vote.meta throws", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { convictionVoting: { vote: unprobeableTx("cv.vote", sink) } } })
    buildVote(api, { pollIndex: 1, aye: true, balance: 5n, conviction: "None" })
    expect(only(sink).args).toHaveLength(2)
  })

  it("falls back to the short removeVote when its meta throws", () => {
    const sink: Recorded[] = []
    const api = asApi({
      tx: { convictionVoting: { removeVote: unprobeableTx("cv.removeVote", sink) } },
    })
    buildRemoveVote(api, 2, 3)
    expect(only(sink).args).toEqual([2, 3])
  })
})

describe("removeVote / unlock / undelegate - remaining arities", () => {
  it("removeVote: 2-arg voteManager", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { voteManager: { removeVote: txFn("vm.removeVote", 2, sink) } } })
    buildRemoveVote(api, 2, 3, sEnjCurrency(1))
    expect(only(sink)).toEqual({ call: "vm.removeVote", args: [2, 3] })
  })

  it("removeVote: 3-arg convictionVoting carries the vote's currency", () => {
    const sink: Recorded[] = []
    const api = asApi({
      tx: { convictionVoting: { removeVote: txFn("cv.removeVote", 3, sink) } },
    })
    buildRemoveVote(api, 2, 3, sEnjCurrency(8))
    expect(only(sink).args).toEqual([2, 3, { SEnj: { tokenId: 8 } }])
  })

  it("unlock: 3-arg voteManager with ENJ by default", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { voteManager: { unlock: txFn("vm.unlock", 3, sink) } } })
    buildUnlock(api, 4, "enAlice")
    expect(only(sink).args).toEqual([4, "enAlice", { Enj: null }])
  })

  it("unlock: 2-arg voteManager", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { voteManager: { unlock: txFn("vm.unlock", 2, sink) } } })
    buildUnlock(api, 4, "enAlice")
    expect(only(sink).args).toEqual([4, "enAlice"])
  })

  it("undelegate: 1-arg voteManager", () => {
    const sink: Recorded[] = []
    const api = asApi({ tx: { voteManager: { undelegate: txFn("vm.undelegate", 1, sink) } } })
    buildUndelegate(api, 6)
    expect(only(sink).args).toEqual([6])
  })
})

describe("getVotesFor", () => {
  it("reads every currency's votes on the track from the triple map", async () => {
    const api = asApi({
      query: {
        convictionVoting: {
          votingFor: storageMap(throws("unused"), () => [
            [
              key(addrArg("me"), num(2), jsonArg({ Enj: null })),
              casting([
                { kind: "Standard", poll: 1, aye: true, conviction: "Locked1x", balance: 7n },
              ]),
            ],
          ]),
        },
      },
    })
    expect(await getVotesFor(api, "me", 2)).toEqual([
      {
        type: "Standard",
        pollIndex: 1,
        trackId: 2,
        aye: true,
        balance: 7n,
        conviction: "Locked1x",
      },
    ])
  })

  it("falls back to the stock double map when the prefix read throws", async () => {
    const api = asApi({
      query: {
        convictionVoting: {
          votingFor: storageMap(
            () => casting([{ kind: "Split", poll: 3, aye: 2n, nay: 1n }]),
            throws("double map has no 2-key prefix"),
          ),
        },
      },
    })
    expect(await getVotesFor(api, "me", 2)).toEqual([
      { type: "Split", pollIndex: 3, trackId: 2, aye: 2n, nay: 1n },
    ])
  })

  it("returns [] when both reads fail", async () => {
    const api = asApi({
      query: { convictionVoting: { votingFor: storageMap(throws("a"), throws("b")) } },
    })
    expect(await getVotesFor(api, "me", 2)).toEqual([])
  })

  it("ignores a Delegating row (no votes of its own)", async () => {
    const api = asApi({
      query: {
        convictionVoting: {
          votingFor: storageMap(throws("unused"), () => [
            [key(addrArg("me"), num(2)), { isCasting: false, isDelegating: true }],
          ]),
        },
      },
    })
    expect(await getVotesFor(api, "me", 2)).toEqual([])
  })
})

describe("getMyVotesOnPoll - weight of split votes", () => {
  it("weighs Split and SplitAbstain by their total, without conviction", async () => {
    const api = asApi({
      query: {
        convictionVoting: {
          votingFor: storageMap(throws("unused"), () => [
            // Standard 100 at 0.1x -> 100
            [
              key(addrArg("me"), num(1), jsonArg({ Enj: null })),
              casting([
                { kind: "Standard", poll: 5, aye: true, conviction: "None", balance: 100n },
              ]),
            ],
            // Split 30 + 20 -> 500
            [
              key(addrArg("me"), num(1), jsonArg({ SEnj: { tokenId: 1 } })),
              casting([{ kind: "Split", poll: 5, aye: 30n, nay: 20n }]),
            ],
            // SplitAbstain 10 + 10 + 60 -> 800
            [
              key(addrArg("me"), num(1), jsonArg({ SEnj: { tokenId: 2 } })),
              casting([{ kind: "SplitAbstain", poll: 5, aye: 10n, nay: 10n, abstain: 60n }]),
            ],
          ]),
        },
      },
    })
    const votes = await getMyVotesOnPoll(api, "me", 1, 5)
    expect(votes.map((v) => v.vote.type)).toEqual(["SplitAbstain", "Split", "Standard"])
    expect(defined(votes[0]).vote).toEqual({
      type: "SplitAbstain",
      pollIndex: 5,
      trackId: 1,
      aye: 10n,
      nay: 10n,
      abstain: 60n,
    })
  })
})

describe("getMyVotesOnPollAnyTrack - defensive key decoding", () => {
  it("skips keys without a usable track, reads a track from toString", async () => {
    const vote = casting([
      { kind: "Standard", poll: 10, aye: true, conviction: "Locked1x", balance: 1n },
    ])
    const api = asApi({
      query: {
        convictionVoting: {
          votingFor: storageMap(throws("unused"), () => [
            [key(addrArg("me")), vote], // no track key
            [key(addrArg("me"), num(Number.NaN)), vote], // unreadable track
            [key(addrArg("me"), { toString: () => "7" }), vote], // no currency key
          ]),
        },
      },
    })
    const votes = await getMyVotesOnPollAnyTrack(api, "me", 10)
    expect(votes).toHaveLength(1)
    expect(defined(votes[0]).vote.trackId).toBe(7)
    expect(defined(votes[0]).currencyRaw).toBeNull()
  })

  it("returns [] when the prefix read throws", async () => {
    const api = asApi({
      query: { convictionVoting: { votingFor: storageMap(throws("a"), throws("b")) } },
    })
    expect(await getMyVotesOnPollAnyTrack(api, "me", 10)).toEqual([])
  })
})

describe("getDelegationsFor - defensive decoding", () => {
  it("returns [] when the prefix read throws", async () => {
    const api = asApi({
      query: { convictionVoting: { votingFor: storageMap(throws("a"), throws("b")) } },
    })
    expect(await getDelegationsFor(api, "me")).toEqual([])
  })

  it("skips unreadable tracks and defaults a missing conviction to None", async () => {
    const delegating = (conviction: unknown) => ({
      isDelegating: true,
      asDelegating: { target: addrArg("enBob"), balance: big(9n), conviction },
    })
    const api = asApi({
      query: {
        convictionVoting: {
          votingFor: storageMap(throws("unused"), () => [
            [key(addrArg("me"), num(Number.NaN)), delegating({ type: "Locked1x" })],
            [key(addrArg("me"), { toString: () => "3" }), delegating(undefined)],
          ]),
        },
      },
    })
    expect(await getDelegationsFor(api, "me")).toEqual([
      { trackId: 3, target: "enBob", balance: 9n, conviction: "None", currencyRaw: null },
    ])
  })
})

describe("listVotesOnPoll", () => {
  const entries = () => [
    [
      key(addrArg("alice"), num(2), jsonArg({ Enj: null })),
      casting([
        { kind: "Standard", poll: 5, aye: true, conviction: "Locked3x", balance: 50n },
        { kind: "Standard", poll: 6, aye: true, conviction: "Locked1x", balance: 1n },
      ]),
    ],
    [
      key(addrArg("bob"), { toString: () => "2" }),
      casting([{ kind: "Split", poll: 5, aye: 3n, nay: 4n }]),
    ],
    [key(addrArg("carol"), num(2)), casting([{ kind: "Split", poll: 9, aye: 1n, nay: 1n }])],
  ]

  it("lists every voter on the poll with the currency from the storage key", async () => {
    const api = asApi({
      query: { convictionVoting: { votingFor: storageMap(throws("unused"), entries) } },
    })
    const voters = await listVotesOnPoll(api, 5)
    expect(voters).toEqual([
      {
        voter: "alice",
        trackId: 2,
        currencyRaw: { Enj: null },
        vote: {
          type: "Standard",
          pollIndex: 5,
          trackId: 2,
          aye: true,
          balance: 50n,
          conviction: "Locked3x",
        },
      },
      {
        voter: "bob",
        trackId: 2,
        currencyRaw: null,
        vote: { type: "Split", pollIndex: 5, trackId: 2, aye: 3n, nay: 4n },
      },
    ])
  })

  it("fills the currency from voteManager.voteCurrencies in either key order", async () => {
    const calls: unknown[][] = []
    const voteCurrencies = async (...a: unknown[]) => {
      calls.push(a)
      // alice is keyed (voter, poll); bob only answers (poll, voter).
      if (a[0] === "alice") return jsonArg({ SEnj: { tokenId: 4 } })
      if (a[1] === "bob") return jsonArg({ Enj: null })
      return jsonArg(null)
    }
    const api = asApi({
      query: {
        convictionVoting: { votingFor: storageMap(throws("unused"), entries) },
        voteManager: { voteCurrencies },
      },
    })
    const voters = await listVotesOnPoll(api, 5)
    expect(voters.map((v) => [v.voter, v.currencyRaw])).toEqual([
      ["alice", { SEnj: { tokenId: 4 } }],
      ["bob", { Enj: null }],
    ])
    expect(calls).toContainEqual([5, "bob"])
  })

  it("keeps the key's currency when the voteManager lookup throws", async () => {
    const api = asApi({
      query: {
        convictionVoting: { votingFor: storageMap(throws("unused"), entries) },
        voteManager: { voteCurrencies: throws("rpc down") },
      },
    })
    const voters = await listVotesOnPoll(api, 5)
    expect(voters.map((v) => v.currencyRaw)).toEqual([{ Enj: null }, null])
  })

  it("returns [] when the runtime has no voting storage", async () => {
    expect(await listVotesOnPoll(asApi({ query: {} }), 5)).toEqual([])
  })
})

describe("getClassLocks", () => {
  it("returns [] when neither key shape can be read", async () => {
    const api = asApi({
      query: {
        convictionVoting: {
          votingFor: storageMap(throws("a"), throws("b")),
          classLocksFor: throws("c"),
        },
      },
    })
    expect(await getClassLocks(api, "me")).toEqual([])
  })
})

describe("getAccountLocks - prior locks and split votes", () => {
  /** One track's lock in `currency`, plus the votingFor rows for it. */
  function lockApi(
    locks: Array<[unknown, number, bigint]>,
    votingEntries: Array<[unknown, unknown]> | (() => never),
    votingFlat: () => unknown = throws("unused"),
  ) {
    return asApi({
      query: {
        convictionVoting: {
          classLocksFor: storageMap(throws("unused"), () =>
            locks.map(([currency, track, amount]) => [
              key(addrArg("me"), jsonArg(currency)),
              [[num(track), big(amount)]],
            ]),
          ),
          votingFor: storageMap(
            votingFlat,
            typeof votingEntries === "function" ? votingEntries : () => votingEntries,
          ),
        },
      },
    })
  }

  it("reports the prior lock left by a removed vote, and skips zero locks", async () => {
    const api = lockApi(
      [
        [{ Enj: null }, 2, 40n],
        [{ Enj: null }, 3, 0n],
      ],
      [[key(addrArg("me"), num(2), jsonArg({ Enj: null })), casting([], [1_000, 40n])]],
    )
    expect(await getAccountLocks(api, "me")).toEqual([
      {
        trackId: 2,
        locked: 40n,
        prior: { unlockAt: 1_000, amount: 40n },
        activeVotes: [],
        currencyRaw: { Enj: null },
      },
    ])
  })

  it("keeps the latest-expiring prior and ignores an empty one", async () => {
    const api = lockApi(
      [["*any*", 2, 10n]],
      [
        [key(addrArg("me"), num(2), jsonArg({ Enj: null })), casting([], [500, 10n])],
        [key(addrArg("me"), num(2), jsonArg({ Enj: null })), casting([], [900, 10n])],
        [key(addrArg("me"), num(2), jsonArg({ Enj: null })), casting([], [2_000, 0n])],
      ],
    )
    const [lock] = await getAccountLocks(api, "me")
    expect(defined(lock).prior).toEqual({ unlockAt: 900, amount: 10n })
  })

  it("reads the prior lock of a delegating row", async () => {
    const api = lockApi(
      [[{ Enj: null }, 2, 10n]],
      [
        [
          key(addrArg("me"), num(2), jsonArg({ Enj: null })),
          { isDelegating: true, asDelegating: { prior: [num(77), big(10n)] } },
        ],
      ],
    )
    const [lock] = await getAccountLocks(api, "me")
    expect(defined(lock).prior).toEqual({ unlockAt: 77, amount: 10n })
    expect(defined(lock).activeVotes).toEqual([])
  })

  it("lists split votes as conviction-less locks holding their total", async () => {
    const api = lockApi(
      [[{ Enj: null }, 2, 100n]],
      [
        [
          key(addrArg("me"), num(2), jsonArg({ Enj: null })),
          casting([
            { kind: "Split", poll: 1, aye: 30n, nay: 20n },
            { kind: "Split", poll: 2, aye: 1n, nay: 9n },
            { kind: "SplitAbstain", poll: 3, aye: 5n, nay: 5n, abstain: 10n },
          ]),
        ],
      ],
    )
    const [lock] = await getAccountLocks(api, "me")
    expect(defined(lock).activeVotes).toEqual([
      { pollIndex: 1, balance: 50n, conviction: "None", aye: true },
      { pollIndex: 2, balance: 10n, conviction: "None", aye: false },
      { pollIndex: 3, balance: 20n, conviction: "None", aye: false },
    ])
  })

  it("matches lock and vote currencies across their JSON spellings", async () => {
    const vote = (poll: number) =>
      casting([{ kind: "Standard", poll, aye: true, conviction: "Locked1x", balance: 1n }])
    const api = lockApi(
      [
        ["Enj", 1, 1n],
        [{ sEnj: { token_id: "7" } }, 1, 1n],
        ["senj", 1, 1n],
      ],
      [
        [key(addrArg("me"), num(1), jsonArg({ enj: null })), vote(100)],
        [key(addrArg("me"), num(1), jsonArg({ SEnj: { tokenId: 7 } })), vote(200)],
        [key(addrArg("me"), num(1), jsonArg({ senj: 8 })), vote(300)],
        [key(addrArg("me"), num(1), jsonArg("SENJ")), vote(400)],
      ],
    )
    const locks = await getAccountLocks(api, "me")
    expect(locks.map((l) => l.activeVotes.map((v) => v.pollIndex))).toEqual([
      [100], // "Enj" string == { enj: null }
      [200], // { sEnj: { token_id: "7" } } == { SEnj: { tokenId: 7 } }, not pool 8
      [400], // bare "senj" only matches another id-less sENJ, never a real pool
    ])
  })

  it("lets a currency it can't read match every vote (stock Substrate)", async () => {
    const api = lockApi(
      [[42, 1, 1n]],
      [
        [
          key(addrArg("me"), num(1), jsonArg({ Enj: null })),
          casting([{ kind: "Split", poll: 1, aye: 1n, nay: 0n }]),
        ],
        [
          key(addrArg("me"), num(1), jsonArg(true)),
          casting([{ kind: "Split", poll: 2, aye: 1n, nay: 0n }]),
        ],
      ],
    )
    const [lock] = await getAccountLocks(api, "me")
    expect(defined(lock).activeVotes.map((v) => v.pollIndex)).toEqual([1, 2])
  })

  it("reads the stock double map when the votingFor prefix read throws", async () => {
    const api = lockApi([[{ Enj: null }, 2, 5n]], throws("double map"), () =>
      casting(
        [{ kind: "Standard", poll: 8, aye: false, conviction: "Locked2x", balance: 5n }],
        [60, 5n],
      ),
    )
    expect(await getAccountLocks(api, "me")).toEqual([
      {
        trackId: 2,
        locked: 5n,
        prior: { unlockAt: 60, amount: 5n },
        activeVotes: [{ pollIndex: 8, balance: 5n, conviction: "Locked2x", aye: false }],
        currencyRaw: { Enj: null },
      },
    ])
  })

  it("shows a lock without detail when no voting state can be read", async () => {
    const api = lockApi([[{ Enj: null }, 2, 5n]], throws("double map"), throws("gone"))
    expect(await getAccountLocks(api, "me")).toEqual([
      { trackId: 2, locked: 5n, prior: null, activeVotes: [], currencyRaw: { Enj: null } },
    ])
  })

  it("returns [] when classLocksFor can't be read in either shape", async () => {
    const api = asApi({
      query: {
        convictionVoting: {
          classLocksFor: storageMap(throws("1-key"), throws("prefix")),
          votingFor: storageMap(throws("a"), throws("b")),
        },
      },
    })
    expect(await getAccountLocks(api, "me")).toEqual([])
  })
})

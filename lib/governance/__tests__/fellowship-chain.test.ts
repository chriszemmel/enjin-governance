import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import {
  buildFellowshipPlaceDeposit,
  buildFellowshipVote,
  decodeFellowshipVote,
  decodeRankedTally,
  fellowshipTrackCaption,
  fellowshipTrackLabel,
  getFellowshipReferendum,
  getFellowshipTracks,
  getMyFellowshipVote,
  hasFellowship,
  listFellowshipReferenda,
  listFellowshipVotes,
  listMembers,
  originTrack,
  rankName,
  rankNumeral,
  recommendedOrigin,
} from "@/lib/governance/fellowship"
import { defined } from "@/test/defined"

/**
 * The chain-facing half of fellowship.ts (members, votes, referenda, the
 * vote extrinsic) and the origin rules, with plain-object codec fakes.
 */

const asApi = (fake: object) => fake as unknown as ApiPromise
const codec = (json: unknown, text = String(json)) => ({ toJSON: () => json, toString: () => text })
const some = (v: unknown) => ({ isSome: true, unwrap: () => v })
const none = () => ({ isSome: false, unwrap: () => undefined })
const num = (n: number) => ({ toNumber: () => n })

describe("hasFellowship", () => {
  it("needs both the collective's members and the fellowship referenda", () => {
    expect(hasFellowship(null)).toBe(false)
    expect(hasFellowship(asApi({ query: { fellowshipCollective: { members: {} } } }))).toBe(false)
    expect(
      hasFellowship(
        asApi({ query: { fellowshipCollective: { members: {} }, fellowshipReferenda: {} } }),
      ),
    ).toBe(true)
  })
})

describe("listMembers", () => {
  it("reads Option and plain member records, highest rank first, then by address", async () => {
    const api = asApi({
      query: {
        fellowshipCollective: {
          members: {
            entries: async () => [
              [{ args: [codec(null, "enB")] }, { unwrapOr: () => codec({ rank: 3 }) }],
              [{ args: [codec(null, "enA")] }, codec({ rank: 3 })],
              [{ args: [codec(null, "enC")] }, codec({ rank: 7 })],
              [{ args: [codec(null, "enD")] }, { unwrapOr: () => null }],
            ],
          },
        },
      },
    })
    expect(await listMembers(api)).toEqual([
      { address: "enC", rank: 7 },
      { address: "enA", rank: 3 },
      { address: "enB", rank: 3 },
      { address: "enD", rank: 0 },
    ])
  })
})

describe("getFellowshipTracks", () => {
  it("refuses a chain without fellowship tracks", () => {
    expect(() => getFellowshipTracks(asApi({ consts: {} }))).toThrow(/fellowshipReferenda\.tracks/)
  })
})

describe("decodeRankedTally / decodeFellowshipVote - edge shapes", () => {
  it("reads nothing from a None entry and defaults missing tally fields to 0", () => {
    expect(decodeRankedTally(none())).toBeNull()
    expect(decodeRankedTally(codec({ ongoing: { tally: { ayes: 5 } } }))).toEqual({
      bareAyes: 0,
      ayes: 5,
      nays: 0,
    })
  })

  it("reads nay and capitalised variants, and nothing from an empty record", () => {
    expect(decodeFellowshipVote({ nay: "6" })).toEqual({ aye: false, weight: 6 })
    expect(decodeFellowshipVote({ Aye: 3 })).toEqual({ aye: true, weight: 3 })
    expect(decodeFellowshipVote({ Nay: 1 })).toEqual({ aye: false, weight: 1 })
    expect(decodeFellowshipVote({})).toBeNull()
    expect(decodeFellowshipVote(null)).toBeNull()
  })
})

describe("listFellowshipVotes", () => {
  it("lists the votes on a poll, heaviest first, skipping empty records", async () => {
    let askedPoll: unknown
    const api = asApi({
      query: {
        fellowshipCollective: {
          voting: {
            entries: async (poll: unknown) => {
              askedPoll = poll
              return [
                [{ args: [num(4), codec(null, "enLow")] }, some(codec({ aye: 1 }))],
                [{ args: [num(4), codec(null, "enHigh")] }, codec({ nay: 10 })],
                [{ args: [num(4), codec(null, "enGone")] }, none()],
                [{ args: [num(4), codec(null, "enTieB")] }, codec({ aye: 3 })],
                [{ args: [num(4), codec(null, "enTieA")] }, codec({ aye: 3 })],
              ]
            },
          },
        },
      },
    })
    expect(await listFellowshipVotes(api, 4)).toEqual([
      { voter: "enHigh", aye: false, weight: 10 },
      { voter: "enTieA", aye: true, weight: 3 },
      { voter: "enTieB", aye: true, weight: 3 },
      { voter: "enLow", aye: true, weight: 1 },
    ])
    expect(askedPoll).toBe(4)
  })
})

describe("getMyFellowshipVote", () => {
  const apiWith = (raw: unknown) =>
    asApi({ query: { fellowshipCollective: { voting: async () => raw } } })

  it("reads Some, None and an unwrapped record", async () => {
    expect(await getMyFellowshipVote(apiWith(some(codec({ aye: 6 }))), 1, "me")).toEqual({
      aye: true,
      weight: 6,
    })
    expect(await getMyFellowshipVote(apiWith(none()), 1, "me")).toBeNull()
    expect(await getMyFellowshipVote(apiWith(codec({ nay: 1 })), 1, "me")).toEqual({
      aye: false,
      weight: 1,
    })
  })
})

describe("fellowship extrinsics", () => {
  it("builds vote(poll, aye) and placeDecisionDeposit(index) with exactly those args", () => {
    const calls: Array<[string, unknown[]]> = []
    const api = asApi({
      tx: {
        fellowshipCollective: { vote: (...a: unknown[]) => calls.push(["vote", a]) },
        fellowshipReferenda: {
          placeDecisionDeposit: (...a: unknown[]) => calls.push(["deposit", a]),
        },
      },
    })
    buildFellowshipVote(api, 12, false)
    buildFellowshipPlaceDeposit(api, 12)
    expect(calls).toEqual([
      ["vote", [12, false]],
      ["deposit", [12]],
    ])
  })
})

describe("fellowship referenda", () => {
  const approved = () => some({ isApproved: true, asApproved: [num(9_000), none(), none()] })

  it("lists decodable referenda newest first and skips empty entries", async () => {
    const api = asApi({
      query: {
        fellowshipReferenda: {
          referendumInfoFor: {
            entries: async () => [
              [{ args: [num(1)] }, approved()],
              [{ args: [num(3)] }, approved()],
              [{ args: [num(2)] }, none()],
            ],
          },
        },
      },
    })
    const refs = await listFellowshipReferenda(api)
    expect(refs.map((r) => [r.index, r.status.type, r.rankedTally])).toEqual([
      [3, "Approved", null],
      [1, "Approved", null],
    ])
  })

  it("reads one referendum, or null when there is none", async () => {
    const api = (raw: unknown) =>
      asApi({ query: { fellowshipReferenda: { referendumInfoFor: async () => raw } } })
    const ref = await getFellowshipReferendum(api(approved()), 3)
    expect(defined(ref).index).toBe(3)
    expect(await getFellowshipReferendum(api(none()), 3)).toBeNull()
  })
})

describe("labels", () => {
  it("falls back for ranks and tracks it can't name", () => {
    expect(rankName(12)).toBe("Rank 12")
    expect(rankNumeral(12)).toBe("12")
    expect(fellowshipTrackLabel(null, 4)).toBe("Track 4")
    expect(fellowshipTrackLabel({ name: "  " }, 4)).toBe("Track 4")
    expect(fellowshipTrackLabel({ name: "senior_fellows" }, 4)).toBe("Senior Fellows")
    expect(fellowshipTrackCaption({ name: "fellows" }, 3)).toBe("Fellows · rank III+")
  })
})

describe("recommendedOrigin / originTrack", () => {
  it("uses Fellows for whitelisting and removing a whitelisted call", () => {
    expect(recommendedOrigin("whitelist")).toBe("Fellows")
    expect(recommendedOrigin("removeWhitelisted")).toBe("Fellows")
  })

  it("has no recommendation for a raw call or a member action without details", () => {
    expect(recommendedOrigin("raw")).toBeNull()
    expect(recommendedOrigin("member")).toBeNull()
  })

  it("adds with rank I's origin and moves rank r with rank r + 2's", () => {
    expect(recommendedOrigin("member", { action: "add", rank: null })).toBe("Fellowship1Dan")
    expect(recommendedOrigin("member", { action: "promote", rank: 2 })).toBe("Fellowship4Dan")
    expect(recommendedOrigin("member", { action: "demote", rank: 5 })).toBe("Fellowship7Dan")
    expect(recommendedOrigin("member", { action: "remove", rank: 0 })).toBe("Fellowship2Dan")
  })

  it("has no origin above rank IX or for an unknown rank", () => {
    expect(recommendedOrigin("member", { action: "demote", rank: 8 })).toBeNull()
    expect(recommendedOrigin("member", { action: "promote", rank: null })).toBeNull()
    expect(recommendedOrigin("member", { action: "remove", rank: null })).toBeNull()
  })

  it("maps named and numbered origins to their track", () => {
    expect(originTrack("Fellows")).toBe(3)
    expect(originTrack("Fellowship6Dan")).toBe(6)
    // Not in the named table (track 3 is "Fellows"), still a valid Dan origin.
    expect(originTrack("Fellowship3Dan")).toBe(3)
    expect(originTrack("Root")).toBeNull()
  })
})

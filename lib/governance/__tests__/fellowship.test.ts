import { describe, expect, it } from "vitest"
import {
  decodeFellowshipVote,
  decodeRankedTally,
  eligibleMembers,
  extractFellowshipIndex,
  FELLOWSHIP_ORIGINS,
  fellowshipTrackCaption,
  fellowshipTrackLabel,
  rankName,
  rankNumeral,
  rankedShares,
  trackMinRank,
  voteWeight,
} from "@/lib/governance/fellowship"

/** Codec-like stand-in for `Option<ReferendumInfo>` as polkadot.js returns it. */
const some = (json: unknown) => ({ isSome: true, unwrap: () => ({ toJSON: () => json }) })

describe("voteWeight", () => {
  it("matches the votes recorded on Canary", () => {
    // Rank IX on track 3 (Fellows): F#0's vote counted 28.
    expect(voteWeight(9, trackMinRank(3))).toBe(28)
    // Rank VII on track 3: 15; rank I on track 1: 1.
    expect(voteWeight(7, 3)).toBe(15)
    expect(voteWeight(1, 1)).toBe(1)
  })

  it("is zero below the track's minimum rank", () => {
    expect(voteWeight(2, 3)).toBe(0)
    expect(voteWeight(0, 1)).toBe(0)
  })
})

describe("ranked tally", () => {
  const members = [
    { address: "a", rank: 9 },
    { address: "b", rank: 9 },
    { address: "c", rank: 7 },
    { address: "d", rank: 7 },
    { address: "e", rank: 7 },
    { address: "f", rank: 2 },
  ]

  it("counts only members of the track's rank or above", () => {
    expect(eligibleMembers(members, 3).map((m) => m.address)).toEqual(["a", "b", "c", "d", "e"])
  })

  it("derives approval by weight and support by head count", () => {
    expect(rankedShares({ bareAyes: 1, ayes: 28, nays: 15 }, 5)).toEqual({
      approval: 28 / 43,
      support: 1 / 5,
    })
    expect(rankedShares({ bareAyes: 0, ayes: 0, nays: 0 }, 0)).toEqual({
      approval: null,
      support: 0,
    })
  })

  it("decodes an ongoing referendum's tally and nothing from a decided one", () => {
    expect(decodeRankedTally(some({ ongoing: { tally: { bareAyes: 1, ayes: 28, nays: 0 } } }))).toEqual({
      bareAyes: 1,
      ayes: 28,
      nays: 0,
    })
    expect(decodeRankedTally(some({ approved: [14091192, null, null] }))).toBeNull()
    expect(decodeRankedTally({ isSome: false })).toBeNull()
  })
})

describe("decodeFellowshipVote", () => {
  it("reads the chain's VoteRecord", () => {
    expect(decodeFellowshipVote({ aye: 28 })).toEqual({ aye: true, weight: 28 })
    expect(decodeFellowshipVote({ nay: 15 })).toEqual({ aye: false, weight: 15 })
    expect(decodeFellowshipVote(null)).toBeNull()
  })
})

describe("labels", () => {
  it("names ranks and tracks", () => {
    expect(rankName(9)).toBe("Grand Master")
    expect(rankNumeral(7)).toBe("VII")
    expect(rankNumeral(0)).toBe("0")
    expect(fellowshipTrackLabel({ name: "senior fellows" }, 4)).toBe("Senior Fellows")
    expect(fellowshipTrackLabel(null, 4)).toBe("Track 4")
    expect(fellowshipTrackCaption({ name: "fellows" }, 3)).toBe("Fellows · rank III+")
  })
})

describe("filing", () => {
  it("offers one origin per track, in track order", () => {
    expect(FELLOWSHIP_ORIGINS.map((o) => o.trackId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(FELLOWSHIP_ORIGINS.find((o) => o.trackId === 3)?.origin).toBe("Fellows")
  })

  it("reads the new F# from the Submitted event", () => {
    const record = (section: string, method: string, data: unknown[]) =>
      ({ event: { section, method, data } }) as never
    expect(
      extractFellowshipIndex([
        record("referenda", "Submitted", [{ toString: () => "18" }]),
        record("fellowshipReferenda", "Submitted", [{ toString: () => "16" }]),
      ]),
    ).toBe(16)
    expect(extractFellowshipIndex([record("system", "ExtrinsicSuccess", [])])).toBeNull()
  })
})

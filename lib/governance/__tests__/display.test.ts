import { describe, expect, it } from "vitest"
import {
  formatTrackName,
  referendumName,
  referendumPath,
  statusDotClasses,
  statusLabel,
} from "@/lib/governance/display"
import type { ReferendumStatusType } from "@/lib/governance/types"

const ALL: ReferendumStatusType[] = [
  "Ongoing",
  "Approved",
  "Rejected",
  "Cancelled",
  "TimedOut",
  "Killed",
]

describe("statusLabel / statusDotClasses", () => {
  it("names every status, calling an ongoing one Active", () => {
    expect(ALL.map(statusLabel)).toEqual([
      "Active",
      "Approved",
      "Rejected",
      "Cancelled",
      "Timed out",
      "Killed",
    ])
  })

  it("keeps green for approved and red for rejected or killed", () => {
    expect(ALL.map(statusDotClasses)).toEqual([
      "bg-primary animate-pulse",
      "bg-green-500",
      "bg-red-500",
      "bg-muted-foreground",
      "bg-muted-foreground",
      "bg-red-500",
    ])
  })
})

describe("formatTrackName", () => {
  it("title-cases snake_case and splits PascalCase", () => {
    expect(formatTrackName("small_tipper")).toBe("Small Tipper")
    expect(formatTrackName("referendum__canceller_")).toBe("Referendum Canceller")
    expect(formatTrackName("WhitelistedCaller")).toBe("Whitelisted Caller")
    expect(formatTrackName("root")).toBe("Root")
  })

  it("leaves names that already have spaces, and empty ones, alone", () => {
    expect(formatTrackName("Big Spender")).toBe("Big Spender")
    expect(formatTrackName("")).toBe("")
  })
})

describe("referendumName / referendumPath", () => {
  it("names and links public and fellowship referenda separately", () => {
    expect(referendumName(12, "referenda")).toBe("referendum #12")
    expect(referendumName(3, "fellowshipReferenda")).toBe("F#3")
    expect(referendumName(4, null)).toBe("referendum #4")
    expect(referendumPath(12, undefined, "enjin")).toBe("/proposals/12?network=enjin")
    expect(referendumPath(3, "fellowshipReferenda", "canary")).toBe("/fellowship/3?network=canary")
  })
})

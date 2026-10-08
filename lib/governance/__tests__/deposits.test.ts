import { describe, expect, it } from "vitest"
import {
  canRefundDeposit,
  depositHold,
  extractReferendumDeposits,
  parsePreimageDeposit,
} from "@/lib/governance/deposits"
import type { Referendum, ReferendumStatusType, TerminalStatus } from "@/lib/governance/types"

const ME = "enAlice"
const OTHER = "enBob"

function ongoing(index: number, sub: string | null, dec: string | null): Referendum {
  return {
    index,
    trackId: 0,
    tally: null,
    status: {
      type: "Ongoing",
      trackId: 0,
      origin: {},
      proposal: { hash: "0x", len: 0 },
      enactment: { type: "After", block: 0 },
      submitted: 0,
      submissionDeposit: sub ? { who: sub, amount: 1n } : (null as never),
      decisionDeposit: dec ? { who: dec, amount: 2n } : null,
      deciding: null,
      tally: { ayes: 0n, nays: 0n, support: 0n },
      inQueue: false,
      alarm: null,
    },
  }
}

function concluded(
  type: TerminalStatus["type"],
  index: number,
  sub: string | null,
  dec: string | null,
): Referendum {
  return {
    index,
    trackId: null,
    tally: null,
    status: {
      type,
      at: 100,
      submissionDeposit: sub ? { who: sub, amount: 3n } : null,
      decisionDeposit: dec ? { who: dec, amount: 10n } : null,
    },
  }
}

const approved = (index: number, sub: string | null, dec: string | null) =>
  concluded("Approved", index, sub, dec)

function killed(index: number): Referendum {
  return { index, trackId: null, tally: null, status: { type: "Killed", at: 100 } }
}

describe("canRefundDeposit", () => {
  // pallet_referenda's take_submission_deposit / take_decision_deposit.
  const table: [ReferendumStatusType, boolean, boolean][] = [
    // status, submission, decision
    ["Ongoing", false, false],
    ["Approved", true, true],
    ["Cancelled", true, true],
    ["Rejected", false, true],
    ["TimedOut", false, true],
    ["Killed", false, false],
  ]
  it.each(table)("%s: submission %s, decision %s", (status, submission, decision) => {
    expect(canRefundDeposit("submission", status)).toBe(submission)
    expect(canRefundDeposit("decision", status)).toBe(decision)
  })
})

describe("depositHold", () => {
  it("is null whenever the deposit can be refunded", () => {
    expect(depositHold("submission", "Approved")).toBeNull()
    expect(depositHold("submission", "Cancelled")).toBeNull()
    expect(depositHold("decision", "Rejected")).toBeNull()
    expect(depositHold("decision", "TimedOut")).toBeNull()
  })

  it("says a rejected or timed-out referendum's submission deposit stays reserved", () => {
    const rejected = depositHold("submission", "Rejected")
    expect(rejected?.label).toBe("Stays reserved")
    expect(rejected?.reason).toMatch(/was rejected/)
    expect(rejected?.reason).toMatch(/only for approved or cancelled/)
    expect(depositHold("submission", "TimedOut")?.reason).toMatch(/timed out/)
  })

  it("holds both deposits of an ongoing referendum until it concludes", () => {
    expect(depositHold("submission", "Ongoing")?.label).toBe("Held until concluded")
    expect(depositHold("submission", "Ongoing")?.reason).toMatch(/approved or cancelled/)
    expect(depositHold("decision", "Ongoing")?.reason).toMatch(/concludes/)
  })

  it("calls a killed referendum's deposits slashed", () => {
    expect(depositHold("submission", "Killed")?.label).toBe("Slashed")
    expect(depositHold("decision", "Killed")?.label).toBe("Slashed")
  })
})

describe("extractReferendumDeposits", () => {
  it("returns my deposits on an approved referendum as refundable", () => {
    const out = extractReferendumDeposits([approved(5, ME, ME)], ME)
    expect(out).toEqual([
      { index: 5, kind: "submission", amount: 3n, status: "Approved", refundable: true },
      { index: 5, kind: "decision", amount: 10n, status: "Approved", refundable: true },
    ])
  })

  it("refunds a cancelled referendum's submission deposit too", () => {
    const out = extractReferendumDeposits([concluded("Cancelled", 6, ME, null)], ME)
    expect(out).toEqual([
      { index: 6, kind: "submission", amount: 3n, status: "Cancelled", refundable: true },
    ])
  })

  it("keeps a rejected or timed-out referendum's submission deposit, but not its decision deposit", () => {
    for (const type of ["Rejected", "TimedOut"] as const) {
      const out = extractReferendumDeposits([concluded(type, 11, ME, ME)], ME)
      expect(out).toEqual([
        { index: 11, kind: "submission", amount: 3n, status: type, refundable: false },
        { index: 11, kind: "decision", amount: 10n, status: type, refundable: true },
      ])
    }
  })

  it("marks ongoing deposits as not refundable yet", () => {
    const out = extractReferendumDeposits([ongoing(7, ME, ME)], ME)
    expect(out.every((d) => d.refundable === false && d.status === "Ongoing")).toBe(true)
    expect(out).toHaveLength(2)
  })

  it("ignores deposits placed by other accounts (pubkey compare)", () => {
    const out = extractReferendumDeposits([approved(8, OTHER, ME)], ME)
    expect(out).toEqual([
      { index: 8, kind: "decision", amount: 10n, status: "Approved", refundable: true },
    ])
  })

  it("skips Killed referenda (deposits were slashed)", () => {
    expect(extractReferendumDeposits([killed(9)], ME)).toEqual([])
  })

  it("handles a missing decision deposit", () => {
    const out = extractReferendumDeposits([approved(10, ME, null)], ME)
    expect(out).toEqual([
      { index: 10, kind: "submission", amount: 3n, status: "Approved", refundable: true },
    ])
  })
})

describe("parsePreimageDeposit", () => {
  const HASH = "0xabc" as `0x${string}`

  it("reads an Unrequested ticket as unnotable", () => {
    const dep = parsePreimageDeposit(
      { unrequested: { ticket: [ME, "0x0de0b6b3a7640000"], len: 45 } },
      HASH,
      ME,
    )
    expect(dep).toEqual({ hash: HASH, len: 45, amount: 10n ** 18n, unnotable: true })
  })

  it("reads a Requested deposit as not unnotable (held by a referendum)", () => {
    const dep = parsePreimageDeposit(
      { requested: { maybeTicket: [ME, 500], maybeLen: 12 } },
      HASH,
      ME,
    )
    expect(dep).toEqual({ hash: HASH, len: 12, amount: 500n, unnotable: false })
  })

  it("returns null when the deposit belongs to someone else", () => {
    expect(
      parsePreimageDeposit({ unrequested: { ticket: [OTHER, "0x1"], len: 1 } }, HASH, ME),
    ).toBeNull()
  })

  it("returns null when there's no deposit tuple", () => {
    expect(parsePreimageDeposit({ requested: { maybeTicket: null } }, HASH, ME)).toBeNull()
  })

  it("falls back to the legacy `deposit` field name", () => {
    const dep = parsePreimageDeposit(
      { unrequested: { deposit: [ME, 7], len: 3 } },
      HASH,
      ME,
    )
    expect(dep).toEqual({ hash: HASH, len: 3, amount: 7n, unnotable: true })
  })
})

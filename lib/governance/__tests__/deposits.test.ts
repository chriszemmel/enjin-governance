import { describe, expect, it } from "vitest"
import {
  extractReferendumDeposits,
  parsePreimageDeposit,
} from "@/lib/governance/deposits"
import type { Referendum } from "@/lib/governance/types"

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

function approved(index: number, sub: string | null, dec: string | null): Referendum {
  return {
    index,
    trackId: null,
    tally: null,
    status: {
      type: "Approved",
      at: 100,
      submissionDeposit: sub ? { who: sub, amount: 3n } : null,
      decisionDeposit: dec ? { who: dec, amount: 10n } : null,
    },
  }
}

function killed(index: number): Referendum {
  return { index, trackId: null, tally: null, status: { type: "Killed", at: 100 } }
}

describe("extractReferendumDeposits", () => {
  it("returns my deposits on a terminal referendum as refundable", () => {
    const out = extractReferendumDeposits([approved(5, ME, ME)], ME)
    expect(out).toEqual([
      { index: 5, kind: "submission", amount: 3n, refundable: true },
      { index: 5, kind: "decision", amount: 10n, refundable: true },
    ])
  })

  it("marks ongoing deposits as not refundable yet", () => {
    const out = extractReferendumDeposits([ongoing(7, ME, ME)], ME)
    expect(out.every((d) => d.refundable === false)).toBe(true)
    expect(out).toHaveLength(2)
  })

  it("ignores deposits placed by other accounts (pubkey compare)", () => {
    const out = extractReferendumDeposits([approved(8, OTHER, ME)], ME)
    expect(out).toEqual([{ index: 8, kind: "decision", amount: 10n, refundable: true }])
  })

  it("skips Killed referenda (deposits were slashed)", () => {
    expect(extractReferendumDeposits([killed(9)], ME)).toEqual([])
  })

  it("handles a missing decision deposit", () => {
    const out = extractReferendumDeposits([approved(10, ME, null)], ME)
    expect(out).toEqual([{ index: 10, kind: "submission", amount: 3n, refundable: true }])
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

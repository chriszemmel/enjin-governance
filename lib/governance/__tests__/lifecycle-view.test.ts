/**
 * What the lifecycle card says, with Enjin Relay referenda as they stood on
 * chain (wss://rpc.relay.blockchain.enjin.io, head 17,593,665 on
 * 2026-10-08 around 08:15 UTC):
 *
 *   #15 MediumSpender spend_local 80,000 ENJ: submitted 17,584,528,
 *       deciding since 17,586,928, not confirming.
 *   #14 MediumSpender spend_local 50,000 ENJ: deciding since 17,408,712,
 *       alarm 17,608,648 (the support curve meets its tally there, before
 *       the period ends at 17,610,312).
 *   #10 Root utility.batchAll: approved 16,880,927, enactment At 16,950,720.
 *   #12 MediumSpender: approved 17,533,282, enacted 17,547,682, proposal #6.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLifecycle, type LifecycleContext } from "@/lib/governance/lifecycle"
import { dayText, finishedSummary, heroFor, stepRows } from "@/lib/governance/lifecycle-view"
import type { OngoingStatus, Referendum, TerminalStatus, Track } from "@/lib/governance/types"

const HEAD = 17_593_665
const NOW = new Date("2026-10-08T08:15:00Z")

const curve = { type: "LinearDecreasing", length: 1, floor: 0, ceil: 0 } as const
const mediumSpender: Track = {
  id: 203,
  name: "medium_spender",
  maxDeciding: 50,
  decisionDeposit: 1n,
  preparePeriod: 2_400,
  decisionPeriod: 201_600,
  confirmPeriod: 14_400,
  minEnactmentPeriod: 14_400,
  minApproval: curve,
  minSupport: curve,
}
const root: Track = { ...mediumSpender, id: 0, name: "root", preparePeriod: 1_200 }
const SPEND = { spendPeriod: 14_400, payout: { status: "unknown" } } as const

function ongoing(index: number, over: Partial<OngoingStatus>): Referendum {
  const status: OngoingStatus = {
    type: "Ongoing",
    trackId: 203,
    origin: {},
    proposal: { hash: "0x" as `0x${string}`, len: 46 },
    enactment: { type: "After", block: 0 },
    submitted: 0,
    submissionDeposit: { who: "x", amount: 0n },
    decisionDeposit: { who: "x", amount: 1n },
    deciding: null,
    tally: { ayes: 0n, nays: 0n, support: 0n },
    inQueue: false,
    alarm: null,
    ...over,
  }
  return { index, status, trackId: status.trackId, tally: status.tally }
}

function approved(index: number, at: number): Referendum {
  const status: TerminalStatus = {
    type: "Approved",
    at,
    submissionDeposit: { who: "x", amount: 0n },
    decisionDeposit: null,
  }
  return { index, status, trackId: null, tally: null }
}

const ref15 = ongoing(15, {
  submitted: 17_584_528,
  deciding: { since: 17_586_928, confirming: null },
  alarm: { when: 17_788_528 },
})
const ref14 = ongoing(14, {
  submitted: 17_406_312,
  deciding: { since: 17_408_712, confirming: null },
  alarm: { when: 17_608_648 },
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe("while voting", () => {
  it("#15: the time left to vote, every step dated, the payout last", () => {
    const lc = getLifecycle(ref15, mediumSpender, HEAD, { spend: SPEND })
    expect(heroFor(lc, HEAD)).toMatchObject({
      big: "13d 12h",
      unit: "left to vote",
      pill: "Deciding",
      approved: false,
    })
    const rows = stepRows(lc, HEAD, "80,000 ENJ")
    expect(rows.map((r) => [r.label, r.state, r.when?.main])).toEqual([
      ["Prepare", "done", "11 hours ago"],
      ["Decide", "active", "ends ≈ Oct 21"],
      ["Confirm", "upcoming", "≈ Oct 22"],
      ["Enact", "upcoming", "≈ Oct 23"],
      ["Payout · 80,000 ENJ", "upcoming", "≈ Oct 24"],
    ])
    expect(rows.find((r) => r.key === "confirm")?.note).toBe("Holds 1d once it passes")
    expect(rows.find((r) => r.key === "enact")?.note).toBe("The call runs 1d after approval")
  })

  it("#14: confirm starts where the chain's alarm says, and nothing claims too little support", () => {
    const lc = getLifecycle(ref14, mediumSpender, HEAD, { spend: SPEND })
    expect(heroFor(lc, HEAD)).toMatchObject({ big: "1d 3h", unit: "left to vote" })
    const rows = stepRows(lc, HEAD, "50,000 ENJ")
    const confirm = rows.find((r) => r.key === "confirm")!
    expect(confirm.note).toBe("Starts at #17,608,648, holds 1d")
    expect(confirm.when?.main).toBe("≈ Oct 10")
    expect(rows.find((r) => r.key === "enact")?.when?.main).toBe("≈ Oct 11")
    expect(rows.every((r) => r.noteTone !== "warn" && !/support too low/i.test(r.note ?? ""))).toBe(
      true,
    )
  })

  it("waits for the decision deposit without a countdown", () => {
    const ref = ongoing(16, { submitted: HEAD - 3_000, decisionDeposit: null })
    const lc = getLifecycle(ref, mediumSpender, HEAD)
    expect(heroFor(lc, HEAD)).toMatchObject({ big: null, pill: "Preparing" })
    expect(stepRows(lc, HEAD, null)[0]).toMatchObject({ state: "active", noteTone: "warn" })
  })
})

describe("after approval", () => {
  const ctx = (over: Partial<LifecycleContext>): LifecycleContext => ({
    history: ref15.status as OngoingStatus,
    ...over,
  })

  it("#10 waiting for its fixed enactment block: no payout step", () => {
    const head = 16_880_927 + 600
    const lc = getLifecycle(approved(10, 16_880_927), root, head, {
      enactment: { status: "scheduled", block: 16_950_720 },
    })
    expect(heroFor(lc, head)).toMatchObject({
      unit: "to enactment",
      pill: "Approved",
      approved: true,
    })
    const rows = stepRows(lc, head, null)
    expect(rows.map((r) => r.key)).toEqual(["prepare", "decide", "confirm", "enact"])
    expect(rows.at(-1)).toMatchObject({
      state: "active",
      when: { main: "#16,950,720", mono: true },
    })
  })

  it("#12 enacted, payout pending: counts down to the spend period", () => {
    const head = 17_550_000
    const lc = getLifecycle(
      approved(12, 17_533_282),
      mediumSpender,
      head,
      ctx({
        enactment: { status: "executed", block: 17_547_682, ok: true },
        spend: { spendPeriod: 14_400, payout: { status: "pending", proposalIndex: 6 } },
      }),
    )
    expect(lc.activeStageId).toBeNull()
    expect(heroFor(lc, head)).toMatchObject({ big: "6h", unit: "to payout", approved: true })
    expect(stepRows(lc, head, "30,000 ENJ").at(-1)).toMatchObject({
      label: "Payout · 30,000 ENJ",
      state: "active",
      when: { main: "#17,553,600" },
    })
  })
})

describe("once it has all happened", () => {
  it("#12 paid out", () => {
    const lc = getLifecycle(approved(12, 17_533_282), mediumSpender, HEAD, {
      enactment: { status: "executed", block: 17_547_682, ok: true },
      spend: { spendPeriod: 14_400, payout: { status: "paid", proposalIndex: 6 } },
    })
    expect(finishedSummary(lc, HEAD, 17_533_282, "30,000 ENJ")).toEqual({
      title: "Paid out 30,000 ENJ",
      sub: "Enacted Oct 5 · treasury proposal #6",
      tone: "ok",
    })
  })

  it("#10 enacted, no treasury spend", () => {
    const lc = getLifecycle(approved(10, 16_880_927), root, HEAD, {
      enactment: { status: "executed", block: 16_950_720, ok: true },
    })
    expect(finishedSummary(lc, HEAD, 16_880_927, null)).toEqual({
      title: "Enacted on Aug 24",
      sub: "Approved Aug 19 · #16,950,720",
      tone: "ok",
    })
  })

  it("a failed call and a rejection say so", () => {
    const failed = getLifecycle(approved(10, 16_880_927), root, HEAD, {
      enactment: { status: "executed", block: 16_950_720, ok: false },
    })
    expect(finishedSummary(failed, HEAD, 16_880_927, null)).toMatchObject({
      sub: "The call failed",
      tone: "danger",
    })
    const rejected: Referendum = {
      ...approved(11, 17_364_701),
      status: { ...(approved(11, 17_364_701).status as TerminalStatus), type: "Rejected" },
    }
    expect(
      finishedSummary(getLifecycle(rejected, mediumSpender, HEAD), HEAD, 17_364_701, null),
    ).toMatchObject({
      title: "Rejected on Sep 22",
      tone: "danger",
    })
  })
})

describe("dayText", () => {
  it("is relative within a day and a date beyond, with the year when it isn't this one", () => {
    expect(dayText(HEAD - 6_000, HEAD)).toBe("10 hours ago")
    expect(dayText(HEAD + 100_800, HEAD)).toBe("Oct 15")
    expect(dayText(HEAD - 14_400 * 300, HEAD)).toBe("Dec 12, 2025")
    expect(dayText(HEAD, null)).toBe("#17,593,665")
  })
})

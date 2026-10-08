/**
 * The Enact stage, the payout and the timeline, with mainnet referendum
 * #12's numbers (MediumSpender, spend_local 30,000 ENJ, read from
 * wss://archive.relay.blockchain.enjin.io):
 *
 *   submitted 17,313,216 · deciding since 17,319,052 · ConfirmStarted
 *   17,518,882 · Approved 17,533,282 · enactment scheduled for (and
 *   dispatched Ok at) 17,547,682 = approval + 14,400 (min enactment, the
 *   desired enactment was After(0)) · treasury proposal #6, awarded at the
 *   spend period 17,553,600 (spendPeriod 14,400).
 */
import { describe, expect, it } from "vitest"
import {
  enactmentStateFrom,
  type EnactmentState,
  getLifecycle,
  type LifecycleContext,
} from "@/lib/governance/lifecycle"
import type { PayoutStatus } from "@/lib/governance/payout"
import type { OngoingStatus, Referendum, TerminalStatus, Track } from "@/lib/governance/types"

const mediumSpender: Track = {
  id: 203,
  name: "medium_spender",
  maxDeciding: 50,
  decisionDeposit: 1n,
  preparePeriod: 2_400,
  decisionPeriod: 201_600,
  confirmPeriod: 14_400,
  minEnactmentPeriod: 14_400,
  minApproval: { type: "LinearDecreasing", length: 1, floor: 0, ceil: 0 },
  minSupport: { type: "LinearDecreasing", length: 1, floor: 0, ceil: 0 },
}

const SUBMITTED = 17_313_216
const DECIDING_SINCE = 17_319_052
const CONFIRM_STARTED = 17_518_882
const APPROVED = 17_533_282
const ENACTED = 17_547_682
const PAYOUT = 17_553_600
const SPEND_PERIOD = 14_400

/** #12 as `referendumInfoFor` holds it at the block before approval. */
function ongoing12(over: Partial<OngoingStatus> = {}): OngoingStatus {
  return {
    type: "Ongoing",
    trackId: 203,
    origin: { Origins: "MediumSpender" },
    proposal: { hash: "0x0e21" as `0x${string}`, len: 46 },
    enactment: { type: "After", block: 0 },
    submitted: SUBMITTED,
    submissionDeposit: { who: "x", amount: 0n },
    decisionDeposit: { who: "x", amount: 1n },
    deciding: { since: DECIDING_SINCE, confirming: APPROVED },
    tally: { ayes: 0n, nays: 0n, support: 0n },
    inQueue: false,
    alarm: null,
    ...over,
  }
}

function asReferendum(status: OngoingStatus): Referendum {
  return { index: 12, status, trackId: 203, tally: status.tally }
}

const approved12: Referendum = (() => {
  const status: TerminalStatus = {
    type: "Approved",
    at: APPROVED,
    submissionDeposit: { who: "x", amount: 0n },
    decisionDeposit: null,
  }
  return { index: 12, status, trackId: null, tally: null }
})()

const history = ongoing12()

function approvedLifecycle(currentBlock: number, enactment: EnactmentState, payout?: PayoutStatus) {
  const context: LifecycleContext = { history, enactment }
  if (payout) context.spend = { spendPeriod: SPEND_PERIOD, payout }
  return getLifecycle(approved12, mediumSpender, currentBlock, context)
}

const stage = (lc: ReturnType<typeof getLifecycle>, id: string) =>
  lc.stages.find((s) => s.id === id)!

describe("Enact stage of an ongoing referendum", () => {
  it("estimates enactment as approval + min enactment for After(0)", () => {
    const lc = getLifecycle(asReferendum(ongoing12()), mediumSpender, 17_530_000)
    expect(lc.activeStageId).toBe("confirm")
    const enact = stage(lc, "enact")
    expect(enact.startBlock).toBe(APPROVED)
    expect(enact.endBlock).toBe(ENACTED)
    expect(enact.state).toBe("upcoming")
  })

  it("follows a longer After(n) past the minimum", () => {
    const lc = getLifecycle(
      asReferendum(ongoing12({ enactment: { type: "After", block: 50_000 } })),
      mediumSpender,
      17_530_000,
    )
    expect(stage(lc, "enact").endBlock).toBe(APPROVED + 50_000)
    expect(stage(lc, "enact").durationBlocks).toBe(50_000)
  })

  it("follows At(b), clamped to the minimum", () => {
    const later = getLifecycle(
      asReferendum(ongoing12({ enactment: { type: "At", block: 17_600_000 } })),
      mediumSpender,
      17_530_000,
    )
    expect(stage(later, "enact").endBlock).toBe(17_600_000)
    const tooSoon = getLifecycle(
      asReferendum(ongoing12({ enactment: { type: "At", block: 17_540_000 } })),
      mediumSpender,
      17_530_000,
    )
    expect(stage(tooSoon, "enact").endBlock).toBe(ENACTED)
  })

  it("shows the desired delay before confirmation starts", () => {
    const lc = getLifecycle(
      asReferendum(
        ongoing12({
          enactment: { type: "After", block: 50_000 },
          deciding: { since: DECIDING_SINCE, confirming: null },
        }),
      ),
      mediumSpender,
      17_400_000,
    )
    const enact = stage(lc, "enact")
    expect(enact.endBlock).toBeNull()
    expect(enact.durationBlocks).toBe(50_000)
  })

  it("lists the events with their blocks while confirming", () => {
    const lc = getLifecycle(asReferendum(ongoing12()), mediumSpender, 17_530_000, {
      spend: { spendPeriod: SPEND_PERIOD, payout: { status: "unknown" } },
    })
    expect(lc.timeline.map((e) => [e.label, e.block, e.approx, e.status])).toEqual([
      ["Submitted", SUBMITTED, false, "done"],
      ["Decision started", DECIDING_SINCE, false, "done"],
      ["Confirm started", CONFIRM_STARTED, false, "done"],
      ["Confirm ends", APPROVED, false, "upcoming"],
      ["Enactment", ENACTED, true, "upcoming"],
      ["Payout", PAYOUT, true, "upcoming"],
    ])
    expect(lc.payout).toEqual({
      state: "upcoming",
      block: PAYOUT,
      approx: true,
      proposalIndex: null,
    })
  })
})

describe("Enact stage of an Approved referendum (#12)", () => {
  it("approved and scheduled: Enact is active until the scheduled block", () => {
    const lc = approvedLifecycle(17_540_482, { status: "scheduled", block: ENACTED })
    expect(lc.terminal).toBe("approved")
    expect(lc.stages.map((s) => s.state)).toEqual(["done", "done", "done", "active"])
    expect(lc.activeStageId).toBe("enact")
    const enact = stage(lc, "enact")
    expect(enact.startBlock).toBe(APPROVED)
    expect(enact.endBlock).toBe(ENACTED)
    expect(enact.durationBlocks).toBe(14_400)
    expect(enact.progress).toBeCloseTo(0.5, 5)
    expect(lc.timeline.map((e) => [e.label, e.block, e.status])).toEqual([
      ["Submitted", SUBMITTED, "done"],
      ["Decision started", DECIDING_SINCE, "done"],
      ["Confirm started", CONFIRM_STARTED, "done"],
      ["Approved", APPROVED, "done"],
      ["Enactment scheduled", ENACTED, "upcoming"],
    ])
  })

  it("places the decided stages from history", () => {
    const lc = approvedLifecycle(17_540_482, { status: "scheduled", block: ENACTED })
    expect([stage(lc, "prepare").startBlock, stage(lc, "prepare").endBlock]).toEqual([
      SUBMITTED,
      DECIDING_SINCE,
    ])
    expect([stage(lc, "decide").startBlock, stage(lc, "decide").endBlock]).toEqual([
      DECIDING_SINCE,
      CONFIRM_STARTED,
    ])
    expect([stage(lc, "confirm").startBlock, stage(lc, "confirm").endBlock]).toEqual([
      CONFIRM_STARTED,
      APPROVED,
    ])
  })

  it("after the block with the lookup absent: Enact done, block estimated when unrecorded", () => {
    const lc = approvedLifecycle(17_550_000, { status: "executed", block: null, ok: null })
    expect(lc.stages.every((s) => s.state === "done")).toBe(true)
    expect(lc.activeStageId).toBeNull()
    expect(lc.overallProgress).toBe(1)
    const executed = lc.timeline.find((e) => e.id === "enactment")!
    expect(executed).toMatchObject({
      label: "Executed",
      block: ENACTED,
      approx: true,
      status: "done",
    })
  })

  it("with the archive record: the exact executed block", () => {
    const lc = approvedLifecycle(17_550_000, { status: "executed", block: ENACTED, ok: true })
    const executed = lc.timeline.find((e) => e.id === "enactment")!
    expect(executed).toMatchObject({ block: ENACTED, approx: false, status: "done" })
    expect(stage(lc, "enact").endBlock).toBe(ENACTED)
  })

  it("a dispatch that failed: Enact failed, no payout", () => {
    const lc = approvedLifecycle(
      17_550_000,
      { status: "executed", block: ENACTED, ok: false },
      { status: "none" },
    )
    expect(stage(lc, "enact").state).toBe("failed")
    expect(lc.payout?.state).toBe("skipped")
    expect(lc.timeline.find((e) => e.id === "enactment")).toMatchObject({
      status: "failed",
      note: "the call failed",
    })
  })

  it("scheduler not read yet: Enact unknown with the estimate, payout unknown", () => {
    const lc = approvedLifecycle(17_550_000, { status: "unknown" }, { status: "unknown" })
    expect(stage(lc, "enact").state).toBe("unknown")
    expect(lc.timeline.find((e) => e.id === "enactment")).toMatchObject({
      block: ENACTED,
      approx: true,
      status: "unknown",
    })
    expect(lc.payout?.state).toBe("unknown")
  })
})

describe("Payout of #12's spend_local", () => {
  it("before enactment: upcoming, estimated at the spend period after the scheduled block", () => {
    const lc = approvedLifecycle(
      17_540_000,
      { status: "scheduled", block: ENACTED },
      { status: "unknown" },
    )
    expect(lc.payout).toEqual({
      state: "upcoming",
      block: PAYOUT,
      approx: true,
      proposalIndex: null,
    })
    // Still four stages: the payout is not a stepper column.
    expect(lc.stages).toHaveLength(4)
  })

  it("payout pending: active, due at the next spend period", () => {
    const lc = approvedLifecycle(
      17_550_000,
      { status: "executed", block: ENACTED, ok: true },
      { status: "pending", proposalIndex: 6 },
    )
    expect(lc.payout).toEqual({ state: "active", block: PAYOUT, approx: false, proposalIndex: 6 })
    expect(lc.timeline.at(-1)).toMatchObject({
      id: "payout",
      block: PAYOUT,
      status: "upcoming",
      note: "if the treasury can cover it",
    })
  })

  it("a pending payout the pot couldn't cover moves on to the following period", () => {
    const lc = approvedLifecycle(
      PAYOUT + 10,
      { status: "executed", block: ENACTED, ok: true },
      { status: "pending", proposalIndex: 6 },
    )
    expect(lc.payout?.block).toBe(PAYOUT + SPEND_PERIOD)
  })

  it("payout gone: done", () => {
    const lc = approvedLifecycle(
      17_560_000,
      { status: "executed", block: ENACTED, ok: true },
      { status: "paid", proposalIndex: 6 },
    )
    expect(lc.payout?.state).toBe("done")
    expect(lc.timeline.at(-1)).toMatchObject({ label: "Paid out", status: "done" })
  })

  it("undetermined after enactment: neutral, never a check", () => {
    const lc = approvedLifecycle(
      17_560_000,
      { status: "executed", block: ENACTED, ok: true },
      { status: "unknown" },
    )
    expect(lc.payout?.state).toBe("unknown")
    expect(lc.timeline.at(-1)?.status).toBe("unknown")
  })

  it("not a spend: no payout", () => {
    const lc = approvedLifecycle(17_560_000, { status: "executed", block: ENACTED, ok: true })
    expect(lc.payout).toBeNull()
    expect(lc.timeline.some((e) => e.id === "payout")).toBe(false)
  })
})

describe("enactmentStateFrom", () => {
  it("lookup present → scheduled", () => {
    expect(enactmentStateFrom({ block: ENACTED, index: 0 }, undefined)).toEqual({
      status: "scheduled",
      block: ENACTED,
    })
  })

  it("lookup not read → unknown", () => {
    expect(enactmentStateFrom(undefined, undefined)).toEqual({ status: "unknown" })
  })

  it("lookup absent → executed, with the record's block and result when read", () => {
    expect(enactmentStateFrom(null, undefined)).toEqual({
      status: "executed",
      block: null,
      ok: null,
    })
    expect(enactmentStateFrom(null, null)).toEqual({ status: "executed", block: null, ok: null })
    expect(enactmentStateFrom(null, { block: ENACTED, ok: true, spends: [] })).toEqual({
      status: "executed",
      block: ENACTED,
      ok: true,
    })
  })

  it("no Dispatched at the scheduled block (cancelled or postponed) → unknown", () => {
    expect(enactmentStateFrom(null, { block: ENACTED, ok: null, spends: [] })).toEqual({
      status: "unknown",
    })
  })
})

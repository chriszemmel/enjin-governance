import { describe, expect, it } from "vitest"
import { getLifecycle } from "@/lib/governance/lifecycle"
import type {
  OngoingStatus,
  Referendum,
  TerminalStatus,
  Track,
} from "@/lib/governance/types"

const track: Track = {
  id: 33,
  name: "small_spender",
  maxDeciding: 50,
  decisionDeposit: 1n,
  preparePeriod: 100,
  decisionPeriod: 1000,
  confirmPeriod: 100,
  minEnactmentPeriod: 100,
  minApproval: { type: "LinearDecreasing", length: 1, floor: 0, ceil: 0 },
  minSupport: { type: "LinearDecreasing", length: 1, floor: 0, ceil: 0 },
}

function ongoing(over: Partial<OngoingStatus> = {}): Referendum {
  const status: OngoingStatus = {
    type: "Ongoing",
    trackId: 33,
    origin: {},
    proposal: { hash: "0x" as `0x${string}`, len: 0 },
    enactment: { type: "After", block: 0 },
    submitted: 1000,
    submissionDeposit: { who: "x", amount: 0n },
    decisionDeposit: null,
    deciding: null,
    tally: { ayes: 0n, nays: 0n, support: 0n },
    inQueue: false,
    alarm: null,
    ...over,
  }
  return { index: 1, status, trackId: 33, tally: status.tally }
}

describe("getLifecycle - ongoing", () => {
  it("places the active stage at prepare while still inside preparePeriod", () => {
    const ref = ongoing()
    const lc = getLifecycle(ref, track, 1050) // halfway through prepare
    expect(lc.activeStageId).toBe("prepare")
    const prepare = lc.stages.find((s) => s.id === "prepare")!
    expect(prepare.state).toBe("active")
    expect(prepare.progress).toBeCloseTo(0.5, 3)
    expect(lc.awaitingDecisionDeposit).toBe(true)
  })

  it("moves to decide once deciding.since is set", () => {
    const ref = ongoing({
      decisionDeposit: { who: "y", amount: 1n },
      deciding: { since: 1100, confirming: null },
    })
    const lc = getLifecycle(ref, track, 1600) // 500 blocks into decide window
    expect(lc.activeStageId).toBe("decide")
    const decide = lc.stages.find((s) => s.id === "decide")!
    expect(decide.state).toBe("active")
    expect(decide.progress).toBeCloseTo(0.5, 3)
    const prepare = lc.stages.find((s) => s.id === "prepare")!
    expect(prepare.state).toBe("done")
    expect(lc.awaitingDecisionDeposit).toBe(false)
  })

  it("moves to confirm when deciding.confirming is set", () => {
    const ref = ongoing({
      decisionDeposit: { who: "y", amount: 1n },
      deciding: { since: 1100, confirming: 1700 },
    })
    const lc = getLifecycle(ref, track, 1650)
    expect(lc.activeStageId).toBe("confirm")
    const confirm = lc.stages.find((s) => s.id === "confirm")!
    expect(confirm.state).toBe("active")
    expect(confirm.startBlock).toBe(1600) // 1700 - confirmPeriod (100)
    expect(confirm.endBlock).toBe(1700)
  })

  it("clamps progress to [0,1] when the chain has overshot the stage end", () => {
    const ref = ongoing({
      decisionDeposit: { who: "y", amount: 1n },
      deciding: { since: 1100, confirming: null },
    })
    const lc = getLifecycle(ref, track, 9999)
    const decide = lc.stages.find((s) => s.id === "decide")!
    expect(decide.progress).toBe(1)
  })

  it("returns zero progress when currentBlock is unknown", () => {
    const ref = ongoing({
      decisionDeposit: { who: "y", amount: 1n },
      deciding: { since: 1100, confirming: null },
    })
    const lc = getLifecycle(ref, track, null)
    const decide = lc.stages.find((s) => s.id === "decide")!
    expect(decide.progress).toBe(0)
  })

  it("flags awaitingDecisionDeposit when prepare is over but deposit is missing", () => {
    const ref = ongoing() // no decisionDeposit, no deciding
    const lc = getLifecycle(ref, track, 1500) // past prepareEnd (1100)
    expect(lc.activeStageId).toBe("prepare")
    expect(lc.awaitingDecisionDeposit).toBe(true)
  })
})

describe("getLifecycle - terminal", () => {
  function terminal(type: TerminalStatus["type"]): Referendum {
    const status: TerminalStatus = {
      type,
      at: 5000,
      submissionDeposit: null,
      decisionDeposit: null,
    }
    return { index: 1, status, trackId: null, tally: null }
  }

  it("approved without the scheduler read: decided stages done, Enact unknown (not a check)", () => {
    const lc = getLifecycle(terminal("Approved"), track, 6000)
    expect(lc.terminal).toBe("approved")
    expect(lc.stages.map((s) => s.state)).toEqual(["done", "done", "done", "unknown"])
    expect(lc.activeStageId).toBeNull()
    expect(lc.overallProgress).toBe(0.75)
  })

  it("timed out: never decided, so only prepare is done", () => {
    const lc = getLifecycle(terminal("TimedOut"), track, 6000)
    expect(lc.stages.map((s) => s.state)).toEqual(["done", "skipped", "skipped", "skipped"])
    expect(lc.timeline.map((e) => e.label)).toEqual(["Submitted", "Timed out"])
  })

  it("lists an outcome's rows before the history arrives, blocks unknown", () => {
    const lc = getLifecycle(terminal("Approved"), track, 6000)
    expect(lc.timeline.map((e) => [e.label, e.block])).toEqual([
      ["Submitted", null],
      ["Decision started", null],
      ["Confirm started", null],
      ["Approved", 5000],
      ["Enactment", 5100],
    ])
    const rejected = getLifecycle(terminal("Rejected"), track, 6000)
    expect(rejected.timeline.map((e) => e.label)).toEqual([
      "Submitted",
      "Decision started",
      "Rejected",
    ])
  })

  it("rejected: prep + decide done, confirm + enact skipped", () => {
    const lc = getLifecycle(terminal("Rejected"), track, 6000)
    expect(lc.terminal).toBe("rejected")
    const ids = (state: string) =>
      lc.stages.filter((s) => s.state === state).map((s) => s.id)
    expect(ids("done")).toEqual(["prepare", "decide"])
    expect(ids("skipped")).toEqual(["confirm", "enact"])
  })

  it("cancelled: all stages cancelled", () => {
    const lc = getLifecycle(terminal("Cancelled"), track, 6000)
    expect(lc.terminal).toBe("cancelled")
    expect(lc.stages.every((s) => s.state === "cancelled")).toBe(true)
  })
})

describe("getLifecycle - overall progress", () => {
  it("computes equal-weight segment progress through the stages", () => {
    const ref = ongoing({
      decisionDeposit: { who: "y", amount: 1n },
      deciding: { since: 1100, confirming: null },
    })
    // Halfway through decide → prepare done (25%) + half of decide (12.5%) = 37.5%
    const lc = getLifecycle(ref, track, 1600)
    expect(lc.overallProgress).toBeCloseTo(0.375, 3)
  })
})

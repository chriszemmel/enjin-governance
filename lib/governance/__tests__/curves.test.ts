import { describe, expect, it } from "vitest"
import { evaluateCurve, sampleCurve } from "@/lib/governance/curves"
import type { GovernanceCurve } from "@/lib/governance/types"

const PB = 1_000_000_000

describe("evaluateCurve - LinearDecreasing", () => {
  // Full-length curve from 100% ceil down to 50% floor.
  const curve: GovernanceCurve = {
    type: "LinearDecreasing",
    length: PB,
    ceil: PB,
    floor: 0.5 * PB,
  }

  it("returns the ceiling at x=0", () => {
    expect(evaluateCurve(curve, 0)).toBeCloseTo(1)
  })

  it("interpolates linearly at the midpoint", () => {
    expect(evaluateCurve(curve, 0.5)).toBeCloseTo(0.75)
  })

  it("reaches the floor at x=1", () => {
    expect(evaluateCurve(curve, 1)).toBeCloseTo(0.5)
  })

  it("holds the floor once past the curve length", () => {
    const short: GovernanceCurve = { ...curve, length: 0.5 * PB }
    expect(evaluateCurve(short, 0.5)).toBeCloseTo(0.5)
    expect(evaluateCurve(short, 1)).toBeCloseTo(0.5)
  })

  it("clamps x below 0 and above 1", () => {
    expect(evaluateCurve(curve, -1)).toBeCloseTo(1)
    expect(evaluateCurve(curve, 2)).toBeCloseTo(0.5)
  })
})

describe("evaluateCurve - SteppedDecreasing", () => {
  // Starts at 50%, drops 10 points every quarter, never below 0.
  const curve: GovernanceCurve = {
    type: "SteppedDecreasing",
    begin: 0.5 * PB,
    end: 0,
    step: 0.1 * PB,
    period: 0.25 * PB,
  }

  it("returns begin before the first step", () => {
    expect(evaluateCurve(curve, 0)).toBeCloseTo(0.5)
    expect(evaluateCurve(curve, 0.2)).toBeCloseTo(0.5)
  })

  it("drops one step per period", () => {
    expect(evaluateCurve(curve, 0.25)).toBeCloseTo(0.4)
    expect(evaluateCurve(curve, 0.5)).toBeCloseTo(0.3)
  })

  it("clamps to end near the tail", () => {
    // begin - step*floor(1/0.25=4) = 0.5 - 0.4 = 0.1, still above end.
    expect(evaluateCurve(curve, 1)).toBeCloseTo(0.1)
  })

  it("never falls below end", () => {
    const steep: GovernanceCurve = { ...curve, step: 0.3 * PB }
    // 0.5 - min(0.5, 0.3*4=1.2) = 0.5 - 0.5 = 0 -> end
    expect(evaluateCurve(steep, 1)).toBeCloseTo(0)
  })
})

describe("evaluateCurve - Reciprocal", () => {
  it("evaluates factor / (x + xOffset) + yOffset", () => {
    // y = 0.5 / x  (clamped to [0,1])
    const curve: GovernanceCurve = {
      type: "Reciprocal",
      factor: BigInt(0.5 * PB),
      xOffset: 0n,
      yOffset: 0n,
    }
    expect(evaluateCurve(curve, 1)).toBeCloseTo(0.5)
    expect(evaluateCurve(curve, 0.5)).toBeCloseTo(1) // 0.5/0.5 = 1
    expect(evaluateCurve(curve, 0.25)).toBeCloseTo(1) // 2, clamped
  })

  it("applies a negative yOffset", () => {
    // y = 0.5 / (x + 0.5) - 0.1
    const curve: GovernanceCurve = {
      type: "Reciprocal",
      factor: BigInt(0.5 * PB),
      xOffset: BigInt(0.5 * PB),
      yOffset: BigInt(-0.1 * PB),
    }
    // x=0.5 -> 0.5/1.0 - 0.1 = 0.4
    expect(evaluateCurve(curve, 0.5)).toBeCloseTo(0.4)
    // x=0 -> 0.5/0.5 - 0.1 = 0.9
    expect(evaluateCurve(curve, 0)).toBeCloseTo(0.9)
  })

  it("saturates to 1 at the asymptote", () => {
    const curve: GovernanceCurve = {
      type: "Reciprocal",
      factor: BigInt(0.5 * PB),
      xOffset: 0n,
      yOffset: 0n,
    }
    expect(evaluateCurve(curve, 0)).toBe(1)
  })
})

describe("sampleCurve", () => {
  const curve: GovernanceCurve = {
    type: "LinearDecreasing",
    length: PB,
    ceil: PB,
    floor: 0,
  }

  it("returns points+1 samples spanning [0,1]", () => {
    const pts = sampleCurve(curve, 10)
    expect(pts).toHaveLength(11)
    expect(pts[0]).toEqual({ x: 0, y: 1 })
    expect(pts[10].x).toBeCloseTo(1)
    expect(pts[10].y).toBeCloseTo(0)
  })

  it("is monotonically decreasing for a decreasing curve", () => {
    const pts = sampleCurve(curve, 20)
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].y).toBeLessThanOrEqual(pts[i - 1].y)
    }
  })
})

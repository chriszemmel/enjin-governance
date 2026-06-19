import { describe, expect, it } from "vitest"
import {
  CONVICTION_LOCK_PERIODS,
  CONVICTION_MULTIPLIER,
  CONVICTIONS,
} from "@/lib/governance/types"

describe("CONVICTIONS", () => {
  it("contains exactly the seven OpenGov variants", () => {
    expect(CONVICTIONS).toEqual([
      "None",
      "Locked1x",
      "Locked2x",
      "Locked3x",
      "Locked4x",
      "Locked5x",
      "Locked6x",
    ])
  })
})

describe("CONVICTION_MULTIPLIER", () => {
  it("matches the OpenGov multiplier table", () => {
    expect(CONVICTION_MULTIPLIER.None).toBe(0.1)
    expect(CONVICTION_MULTIPLIER.Locked1x).toBe(1)
    expect(CONVICTION_MULTIPLIER.Locked2x).toBe(2)
    expect(CONVICTION_MULTIPLIER.Locked3x).toBe(3)
    expect(CONVICTION_MULTIPLIER.Locked4x).toBe(4)
    expect(CONVICTION_MULTIPLIER.Locked5x).toBe(5)
    expect(CONVICTION_MULTIPLIER.Locked6x).toBe(6)
  })

  it("has an entry for every conviction", () => {
    for (const c of CONVICTIONS) {
      expect(CONVICTION_MULTIPLIER[c]).toBeDefined()
    }
  })
})

describe("CONVICTION_LOCK_PERIODS", () => {
  it("doubles per step, matching the OpenGov spec", () => {
    expect(CONVICTION_LOCK_PERIODS.None).toBe(0)
    expect(CONVICTION_LOCK_PERIODS.Locked1x).toBe(1)
    expect(CONVICTION_LOCK_PERIODS.Locked2x).toBe(2)
    expect(CONVICTION_LOCK_PERIODS.Locked3x).toBe(4)
    expect(CONVICTION_LOCK_PERIODS.Locked4x).toBe(8)
    expect(CONVICTION_LOCK_PERIODS.Locked5x).toBe(16)
    expect(CONVICTION_LOCK_PERIODS.Locked6x).toBe(32)
  })
})

import { describe, expect, it } from "vitest"
import {
  enactmentLabel,
  resolveEnactment,
  validateEnactment,
  type EnactmentChoice,
} from "@/lib/governance/enactment"

describe("resolveEnactment", () => {
  it("standard → After 0", () => {
    expect(resolveEnactment({ mode: "standard" })).toEqual({ type: "After", block: 0 })
  })

  it("afterDelay → After n (floored, non-negative)", () => {
    expect(resolveEnactment({ mode: "afterDelay", blocks: 100 })).toEqual({
      type: "After",
      block: 100,
    })
    expect(resolveEnactment({ mode: "afterDelay", blocks: -5 })).toEqual({
      type: "After",
      block: 0,
    })
    expect(resolveEnactment({ mode: "afterDelay", blocks: 10.9 })).toEqual({
      type: "After",
      block: 10,
    })
  })

  it("atBlock → At block", () => {
    expect(resolveEnactment({ mode: "atBlock", block: 5000 })).toEqual({
      type: "At",
      block: 5000,
    })
  })
})

describe("validateEnactment", () => {
  it("accepts standard always", () => {
    expect(validateEnactment({ mode: "standard" })).toBeNull()
  })

  it("rejects negative / non-integer delays", () => {
    expect(validateEnactment({ mode: "afterDelay", blocks: -1 })).toMatch(/non-negative/)
    expect(validateEnactment({ mode: "afterDelay", blocks: 1.5 })).toMatch(/whole number/)
    expect(validateEnactment({ mode: "afterDelay", blocks: 0 })).toBeNull()
  })

  it("rejects non-positive At heights", () => {
    expect(validateEnactment({ mode: "atBlock", block: 0 })).toMatch(/positive/)
  })

  it("rejects an At height in the past", () => {
    expect(
      validateEnactment({ mode: "atBlock", block: 90 }, { currentBlock: 100 }),
    ).toMatch(/past/)
  })

  it("rejects an At height before the min-enactment floor", () => {
    const err = validateEnactment(
      { mode: "atBlock", block: 150 },
      { currentBlock: 100, minEnactment: 100 },
    )
    expect(err).toMatch(/Too soon/)
  })

  it("accepts an At height past the floor", () => {
    expect(
      validateEnactment(
        { mode: "atBlock", block: 250 },
        { currentBlock: 100, minEnactment: 100 },
      ),
    ).toBeNull()
  })
})

describe("enactmentLabel", () => {
  it("labels each mode", () => {
    const cases: [EnactmentChoice, RegExp][] = [
      [{ mode: "standard" }, /as soon as possible/i],
      [{ mode: "afterDelay", blocks: 7 }, /7 block/],
      [{ mode: "atBlock", block: 42 }, /#42/],
    ]
    for (const [choice, re] of cases) {
      expect(enactmentLabel(choice)).toMatch(re)
    }
  })
})

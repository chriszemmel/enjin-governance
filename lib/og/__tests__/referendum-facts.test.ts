import { describe, expect, it } from "vitest"
import { actionFact, fitTitle, TITLE_FLOOR } from "@/lib/og/referendum-facts"

describe("fitTitle", () => {
  it("keeps short titles on one line, scaled up to 104px, and sets medium ones large on two", () => {
    expect(fitTitle("Referendum #13")).toEqual({ text: "Referendum #13", size: 104, lines: 1 })
    // Relay #15: one line would need 49px, under the floor, so two lines at 84px.
    expect(fitTitle("Enjin Misfits: a community nomination pool")).toEqual({
      text: "Enjin Misfits: a community nomination pool",
      size: 84,
      lines: 2,
    })
  })

  it("wraps longer titles without going under the floor, and never past four lines", () => {
    const fit = fitTitle(
      "Fund a twelve month community growth campaign for Enjin with partnerships and creator grants",
    )
    expect(fit.lines).toBeGreaterThan(1)
    expect(fit.lines).toBeLessThanOrEqual(4)
    expect(fit.size).toBeGreaterThanOrEqual(TITLE_FLOOR)
    expect(fit.text.endsWith("…")).toBe(false)
  })

  it("cuts a 200-character title at a word, without a dangling filler word", () => {
    const fit = fitTitle(
      "Treasury proposal to fund a twelve month marketing, partnerships and community growth campaign for the Enjin ecosystem including creator grants, events, translations and a quarterly public report",
    )
    expect(fit.size).toBe(TITLE_FLOOR)
    expect(fit.text.endsWith("…")).toBe(true)
    expect(fit.text).not.toMatch(/\s(a|and|the|for)…$/)
    expect(fit.text).not.toMatch(/[,\s]…$/)
  })
})

describe("actionFact", () => {
  it("names runtime upgrades, batches and cancellations in words, with the raw call small", () => {
    expect(
      actionFact({ section: "system", method: "authorizeUpgrade", args: { code_hash: "0xb3c5e0db1234567890" } }),
    ).toEqual({ kind: "action", label: "Runtime upgrade", detail: "system.authorizeUpgrade · 0xb3c5e0db…" })
    expect(actionFact({ section: "utility", method: "batch_all", args: { calls: [{}, {}, {}, {}] } })).toEqual({
      kind: "action",
      label: "Batch · 4 calls",
      detail: "utility.batchAll",
    })
    expect(actionFact({ section: "referenda", method: "cancel", args: { index: "1,234" } })).toMatchObject({
      label: "Cancel referendum #1234",
    })
  })

  it("shows anything else as pallet.method", () => {
    expect(actionFact({ section: "staking", method: "setValidatorCount", args: {} })).toEqual({
      kind: "action",
      label: "staking.setValidatorCount",
      detail: null,
    })
  })
})

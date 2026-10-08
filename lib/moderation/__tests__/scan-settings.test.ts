import { describe, expect, it } from "vitest"
import {
  DEFAULT_SCAN_MODEL,
  DEFAULT_SCAN_SETTINGS,
  SCAN_MODEL_IDS,
  SCAN_MODELS,
  costUsd,
  parseStoredSettings,
  scanSettingsSchema,
} from "@/lib/moderation/scan-settings"

describe("scan settings", () => {
  it("default to off, with Haiku and every kind checked", () => {
    expect(DEFAULT_SCAN_SETTINGS).toMatchObject({
      enabled: false,
      model: "claude-haiku-5-5",
      images: true,
    })
    expect(scanSettingsSchema.safeParse(DEFAULT_SCAN_SETTINGS).success).toBe(true)
  })

  it("merge stored values over the defaults and reject junk", () => {
    expect(parseStoredSettings({ enabled: true, model: "claude-opus-5-5" })).toMatchObject({
      enabled: true,
      model: "claude-opus-5-5",
      comments: true,
    })
    expect(parseStoredSettings({ model: "gpt-9" })).toEqual(DEFAULT_SCAN_SETTINGS)
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SCAN_SETTINGS)
    expect(scanSettingsSchema.safeParse({ ...DEFAULT_SCAN_SETTINGS, extra: 1 }).success).toBe(false)
  })

  it("offer exactly one recommended model, which is the default", () => {
    const recommended = SCAN_MODEL_IDS.filter((id) => SCAN_MODELS[id].recommended)
    expect(recommended).toEqual([DEFAULT_SCAN_MODEL])
    expect(DEFAULT_SCAN_SETTINGS.model).toBe(DEFAULT_SCAN_MODEL)
  })

  it("move a model that is no longer offered to the recommended one, keeping the rest", () => {
    expect(
      parseStoredSettings({ enabled: true, model: "claude-haiku-3", dailyLimit: 50, pdfs: false }),
    ).toEqual({ ...DEFAULT_SCAN_SETTINGS, enabled: true, dailyLimit: 50, pdfs: false })
  })

  it("move a saved model that the 5.5 models replaced to the recommended one", () => {
    for (const model of ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]) {
      expect(parseStoredSettings({ enabled: true, model }).model).toBe("claude-haiku-5-5")
    }
  })

  it("price tokens per model, keeping the replaced ones for past usage", () => {
    expect(costUsd("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(0.6)
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 1_000_000)).toBe(12)
    expect(costUsd("claude-opus-5-5", 1_000_000, 1_000_000)).toBe(24)
    expect(costUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBe(6)
    expect(costUsd("claude-opus-5", 2_000, 200)).toBeCloseTo(0.015)
    expect(costUsd("unknown", 1_000, 1_000)).toBe(0)
  })
})

import { describe, expect, it, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  env: { ANTHROPIC_API_KEY: "test-key" as string | undefined },
  stored: null as unknown,
  today: 0,
  failRead: false,
}))
vi.mock("@/lib/env", () => ({ env: state.env }))
vi.mock("@/lib/db/moderation", () => ({
  getSetting: async () => {
    if (state.failRead) throw new Error('relation "moderation_settings" does not exist')
    return state.stored
  },
  saveSetting: async (_: string, v: unknown) => {
    state.stored = v
  },
  scanChecksToday: async () => state.today,
  recordScanUsage: async () => undefined,
}))

import { resetScanSettingsCache, saveScanSettings, scanPlan } from "@/lib/moderation/settings-store"
import { DEFAULT_SCAN_SETTINGS } from "@/lib/moderation/scan-settings"

describe("scanPlan", () => {
  beforeEach(() => {
    resetScanSettingsCache()
    state.env.ANTHROPIC_API_KEY = "test-key"
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: true }
    state.today = 0
    state.failRead = false
  })

  it("checks with the chosen model while under the daily limit", async () => {
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: true, model: "claude-opus-5" }
    expect((await scanPlan("images"))?.model).toBe("claude-opus-5")
  })

  it("skips everything without an API key or while switched off", async () => {
    state.env.ANTHROPIC_API_KEY = undefined
    expect(await scanPlan("images")).toBeNull()
    state.env.ANTHROPIC_API_KEY = "test-key"
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: false }
    expect(await scanPlan("images")).toBeNull()
  })

  it("skips kinds that are switched off, and stops at the daily limit", async () => {
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: true, comments: false, dailyLimit: 5 }
    expect(await scanPlan("comments")).toBeNull()
    expect(await scanPlan("proposals")).not.toBeNull()
    state.today = 5
    expect(await scanPlan("proposals")).toBeNull()
  })

  it("is off when the settings can't be read", async () => {
    state.failRead = true
    expect(await scanPlan("images")).toBeNull()
  })

  it("applies a saved change at once on this instance", async () => {
    expect((await scanPlan("images"))?.model).toBe("claude-haiku-4-5")
    await saveScanSettings(
      { ...DEFAULT_SCAN_SETTINGS, enabled: true, model: "claude-sonnet-5" },
      "0xab",
    )
    expect((await scanPlan("images"))?.model).toBe("claude-sonnet-5")
  })
})

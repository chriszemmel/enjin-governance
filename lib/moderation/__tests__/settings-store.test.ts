import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { ANTHROPIC_API_KEY: "test-key" as string | undefined },
  stored: null as unknown,
  today: 0,
  failRead: null as Error | null,
  failCount: false,
}))
vi.mock("@/lib/env", () => ({ env: state.env }))
vi.mock("@/lib/db/moderation", () => ({
  getSetting: async () => {
    if (state.failRead) throw state.failRead
    return state.stored
  },
  saveSetting: async (_: string, v: unknown) => {
    state.stored = v
  },
  reserveScanCheck: async (_m: string, _k: string, limit: number) => {
    if (state.failCount) throw new Error("Connection terminated unexpectedly")
    if (state.today >= limit) return false
    state.today += 1
    return true
  },
  addScanTokens: async () => undefined,
}))

import {
  getScanSettings,
  loadScanSettings,
  reserveScan,
  resetScanSettingsCache,
  saveScanSettings,
  scanPlan,
} from "@/lib/moderation/settings-store"
import { DEFAULT_SCAN_SETTINGS } from "@/lib/moderation/scan-settings"

describe("scanPlan", () => {
  beforeEach(() => {
    resetScanSettingsCache()
    state.env.ANTHROPIC_API_KEY = "test-key"
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: true }
    state.today = 0
    state.failRead = null
    state.failCount = false
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const missingTable = () =>
    Object.assign(new Error('relation "moderation_settings" does not exist'), { code: "42P01" })

  it("checks with the chosen model while under the daily limit", async () => {
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: true, model: "claude-opus-5-5" }
    expect((await scanPlan("images"))?.model).toBe("claude-opus-5-5")
  })

  it("skips everything without an API key or while switched off", async () => {
    state.env.ANTHROPIC_API_KEY = undefined
    expect(await scanPlan("images")).toBeNull()
    state.env.ANTHROPIC_API_KEY = "test-key"
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: false }
    expect(await scanPlan("images")).toBeNull()
  })

  it("skips kinds that are off, and counts each check against the daily limit", async () => {
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: true, comments: false, dailyLimit: 5 }
    expect(await scanPlan("comments")).toBeNull()
    const plan = (await scanPlan("proposals"))!
    state.today = 3
    expect(await reserveScan("proposals", plan)).toBe(true) // 4th
    expect(await reserveScan("proposals", plan)).toBe(true) // 5th
    expect(await reserveScan("proposals", plan)).toBe(false) // 6th: over
  })

  it("is off when the settings can't be read", async () => {
    state.failRead = missingTable()
    expect(await scanPlan("images")).toBeNull()
    resetScanSettingsCache()
    state.failRead = new Error("Connection terminated unexpectedly")
    expect(await scanPlan("images")).toBeNull()
  })

  it("keeps the last settings it read through a database error, and retries soon", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-26T09:00:00Z"))
    expect((await scanPlan("images"))?.model).toBe("claude-haiku-5-5")
    vi.setSystemTime(new Date("2026-09-26T09:00:31Z"))
    state.failRead = new Error("Connection terminated unexpectedly")
    // Still on: a short outage must not switch the checks off.
    expect((await scanPlan("images"))?.model).toBe("claude-haiku-5-5")
    state.failRead = null
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: false }
    vi.setSystemTime(new Date("2026-09-26T09:00:37Z"))
    expect(await scanPlan("images")).toBeNull()
  })

  it("switches off at once when the settings table is missing", async () => {
    expect((await getScanSettings()).enabled).toBe(true)
    resetScanSettingsCache()
    state.failRead = missingTable()
    expect(await getScanSettings()).toEqual(DEFAULT_SCAN_SETTINGS)
  })

  it("refuses a check it can't count, so the daily limit is a hard cap", async () => {
    const plan = (await scanPlan("images"))!
    state.failCount = true
    expect(await reserveScan("images", plan)).toBe(false)
    expect(await reserveScan("comments", plan)).toBe(false)
    state.failCount = false
    expect(await reserveScan("images", plan)).toBe(true)
  })

  it("loads the saved model even when it is no longer offered", async () => {
    state.stored = { ...DEFAULT_SCAN_SETTINGS, enabled: true, model: "claude-retired-1" }
    const loaded = await loadScanSettings()
    expect(loaded.savedModel).toBe("claude-retired-1")
    expect(loaded.settings.model).toBe("claude-haiku-5-5")
    state.stored = null
    expect(await loadScanSettings()).toEqual({ settings: DEFAULT_SCAN_SETTINGS, savedModel: null })
    state.failRead = new Error("down")
    await expect(loadScanSettings()).rejects.toThrow("down")
  })

  it("applies a saved change at once on this instance", async () => {
    expect((await scanPlan("images"))?.model).toBe("claude-haiku-5-5")
    await saveScanSettings(
      { ...DEFAULT_SCAN_SETTINGS, enabled: true, model: "claude-sonnet-5-5" },
      "0xab",
    )
    expect((await scanPlan("images"))?.model).toBe("claude-sonnet-5-5")
  })
})

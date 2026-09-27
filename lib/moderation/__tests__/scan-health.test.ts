/**
 * Content-check health: a broken setup is recorded once, repeats don't
 * write, the next check that works clears it, and moderators are told
 * when it turns bad. The database and Telegram are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  stored: null as unknown,
  reads: 0,
  writes: [] as unknown[],
  fail: null as Error | null,
}))
const notices = vi.hoisted(() => [] as string[])

vi.mock("@/lib/db/moderation", () => ({
  getSetting: async (key: string) => {
    expect(key).toBe("content_scan_health")
    db.reads += 1
    if (db.fail) throw db.fail
    return db.stored
  },
  saveSetting: async (key: string, value: unknown) => {
    expect(key).toBe("content_scan_health")
    db.writes.push(value)
    if (db.fail) throw db.fail
    db.stored = value
  },
}))
vi.mock("@/lib/moderation/notify", () => ({
  notifyScanProblem: async (text: string) => void notices.push(text),
}))

import {
  nextHealth,
  noteScanHealth,
  readScanHealth,
  resetScanHealthCache,
  SCAN_PROBLEM_TEXT,
  type ScanHealth,
} from "@/lib/moderation/scan-health"
import type { ScanOutcome } from "@/lib/moderation/scan"

const T0 = new Date("2026-09-26T09:00:00Z")
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

const keyRefused: ScanOutcome = {
  kind: "unavailable",
  reason: "API 401",
  cause: "config",
  problem: "api_key",
}
const noCredit: ScanOutcome = {
  kind: "unavailable",
  reason: "API 400",
  cause: "config",
  problem: "billing",
}
const allowed: ScanOutcome = {
  kind: "verdict",
  verdict: { decision: "allow", severity: "low", labels: [], explanation: "Fine." },
}
const failing = (problem: "api_key" | "billing", first: Date, last = first): ScanHealth => ({
  state: "failing",
  problem,
  firstSeen: first.toISOString(),
  lastSeen: last.toISOString(),
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  resetScanHealthCache()
  db.stored = null
  db.reads = 0
  db.writes = []
  db.fail = null
  notices.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

describe("nextHealth", () => {
  it("writes only when the state changes", () => {
    const bad = failing("api_key", T0)
    expect(nextHealth(null, { kind: "ok" }, T0)).toEqual({ write: null, newProblem: false })
    expect(nextHealth({ state: "ok", since: T0.toISOString() }, { kind: "ok" }, T0).write).toBe(
      null,
    )
    expect(nextHealth(null, { kind: "failing", problem: "api_key" }, T0)).toEqual({
      write: bad,
      newProblem: true,
    })
    expect(nextHealth(bad, { kind: "failing", problem: "api_key" }, at(14)).write).toBe(null)
    expect(nextHealth(bad, { kind: "ok" }, at(1))).toEqual({
      write: { state: "ok", since: at(1).toISOString() },
      newProblem: false,
    })
  })

  it("refreshes last seen every 15 minutes, keeping first seen", () => {
    const bad = failing("api_key", T0)
    expect(nextHealth(bad, { kind: "failing", problem: "api_key" }, at(15))).toEqual({
      write: failing("api_key", T0, at(15)),
      newProblem: false,
    })
  })

  it("treats a different problem as a new one", () => {
    expect(
      nextHealth(failing("api_key", T0), { kind: "failing", problem: "billing" }, at(3)),
    ).toEqual({ write: failing("billing", at(3)), newProblem: true })
  })
})

describe("noteScanHealth", () => {
  it("records a broken setup once and tells moderators once", async () => {
    for (let i = 0; i < 20; i += 1) await noteScanHealth(keyRefused)
    expect(db.writes).toEqual([failing("api_key", T0)])
    expect(notices).toEqual([SCAN_PROBLEM_TEXT.api_key])
    expect(db.reads).toBe(1)
    expect(await readScanHealth()).toEqual(failing("api_key", T0))
  })

  it("writes and tells once when checks fail side by side", async () => {
    await Promise.all(Array.from({ length: 8 }, () => noteScanHealth(keyRefused)))
    expect(db.writes).toHaveLength(1)
    expect(notices).toHaveLength(1)
  })

  it("leaves the record alone for outages and items the API refused", async () => {
    await noteScanHealth({ kind: "unavailable", reason: "API 529", cause: "outage" })
    await noteScanHealth({ kind: "unavailable", reason: "timeout", cause: "outage" })
    await noteScanHealth({ kind: "unavailable", reason: "API 400", cause: "input" })
    expect(db.reads).toBe(0)
    expect(db.writes).toEqual([])

    await noteScanHealth(keyRefused)
    await noteScanHealth({ kind: "unavailable", reason: "API 500", cause: "outage" })
    // An outage doesn't clear a broken setup either.
    expect(db.writes).toEqual([failing("api_key", T0)])
  })

  it("clears on the next check that gets an answer, then stays quiet", async () => {
    await noteScanHealth(keyRefused)
    vi.setSystemTime(at(2))
    await noteScanHealth(allowed)
    await noteScanHealth(allowed)
    await noteScanHealth({ kind: "refused" })
    expect(db.writes).toEqual([failing("api_key", T0), { state: "ok", since: at(2).toISOString() }])
    expect(notices).toHaveLength(1)
  })

  it("refreshes last seen while the problem lasts, at most every 15 minutes", async () => {
    await noteScanHealth(keyRefused)
    vi.setSystemTime(at(10))
    await noteScanHealth(keyRefused)
    vi.setSystemTime(at(16))
    await noteScanHealth(keyRefused)
    await noteScanHealth(keyRefused)
    expect(db.writes).toEqual([failing("api_key", T0), failing("api_key", T0, at(16))])
    expect(notices).toHaveLength(1)
  })

  it("reports a new problem again", async () => {
    await noteScanHealth(keyRefused)
    vi.setSystemTime(at(5))
    await noteScanHealth(noCredit)
    expect(db.writes.at(-1)).toEqual(failing("billing", at(5)))
    expect(notices).toEqual([SCAN_PROBLEM_TEXT.api_key, SCAN_PROBLEM_TEXT.billing])
  })

  it("clears a problem another server recorded", async () => {
    db.stored = failing("billing", at(-30))
    await noteScanHealth(allowed)
    expect(db.writes).toEqual([{ state: "ok", since: T0.toISOString() }])
  })

  it("re-reads the record every 5 minutes", async () => {
    await noteScanHealth(allowed) // reads: nothing recorded
    db.stored = failing("billing", at(1)) // another server
    vi.setSystemTime(at(4))
    await noteScanHealth(allowed)
    expect(db.writes).toEqual([])
    vi.setSystemTime(at(6))
    await noteScanHealth(allowed)
    expect(db.writes).toEqual([{ state: "ok", since: at(6).toISOString() }])
  })

  it("never throws when the database is down, and doesn't retry every check", async () => {
    db.fail = new Error("Connection terminated unexpectedly")
    await expect(noteScanHealth(keyRefused)).resolves.toBeUndefined()
    await noteScanHealth(keyRefused)
    await noteScanHealth(keyRefused)
    expect(db.writes).toHaveLength(1)
    expect(notices).toEqual([SCAN_PROBLEM_TEXT.api_key])
    await expect(readScanHealth()).rejects.toThrow()
  })

  it("ignores a record it can't make sense of", async () => {
    db.stored = { state: "failing", problem: "gremlins" }
    expect(await readScanHealth()).toBeNull()
  })
})

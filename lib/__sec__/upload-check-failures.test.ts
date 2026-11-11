/**
 * POST /api/proposals/[uuid]/media when the automatic check itself can't
 * do its job:
 *   - the check can't be counted against the daily limit (database error):
 *     the upload is held for a moderator, or refused with "try again" when
 *     the hold can't be saved either - never stored unchecked;
 *   - the setup is broken (key refused, no credit): the upload goes
 *     through as in an outage, the failure is recorded once and moderators
 *     are told once.
 * Real route handler, real checks and health record; only I/O (session,
 * database, bucket, rate-limit store, Anthropic, Telegram) is faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import sharp from "sharp"

const ALICE = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key"
})
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; address: string; handle: string | null },
}))
const ai = vi.hoisted(() => ({ next: null as unknown, images: 0 }))
const notices = vi.hoisted(() => ({ reports: [] as unknown[], problems: [] as string[] }))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() {
      throw new Error("no Anthropic API in tests")
    }
  },
}))
vi.mock("@/lib/moderation/scan", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  scanImage: async () => {
    ai.images += 1
    return ai.next
  },
}))
vi.mock("@/lib/moderation/notify", () => ({
  notifyNewReport: async (n: unknown) => void notices.reports.push(n),
  notifyScanProblem: async (text: string) => void notices.problems.push(text),
}))
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => auth.user }))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/r2/client", () => ({
  isR2Configured: () => true,
  isPublicUrlMisconfigured: () => false,
  r2Bucket: () => "enjin-governance",
  publicAssetBase: () => "https://fake.local/r",
  r2PublicBase: () => "https://pub.r2.dev",
}))
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  enforceRateLimit: async () => ({ allowed: true, remaining: 9, resetAt: 0, retryAfterSeconds: 0 }),
}))
vi.mock("@/lib/db/moderation", async () => await import("./fake-moderation"))
vi.mock("@/lib/db/proposals", async () => await import("./fake-db"))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))

import * as bucketMod from "./fake-bucket"
import * as db from "./fake-db"
import * as mod from "./fake-moderation"
import { DEFAULT_SCAN_SETTINGS } from "@/lib/moderation/scan-settings"
import { resetScanHealthCache } from "@/lib/moderation/scan-health"
import { resetScanSettingsCache } from "@/lib/moderation/settings-store"
import { POST } from "@/app/api/proposals/[uuid]/media/route"

const NET = "enjin-relay"
const PID = "22222222-2222-4222-8222-222222222222"

const png = () =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 90, b: 200 } } })
    .png()
    .toBuffer()

async function upload() {
  const form = new FormData()
  form.append("file", new File([new Uint8Array(await png())], "chart.png", { type: "image/png" }))
  const res = await POST(
    new NextRequest(`https://gov.test/api/proposals/${PID}/media?network=${NET}`, {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ uuid: PID }) },
  )
  return {
    res,
    body: (await res.json()) as {
      ok: boolean
      error?: string
      moderation?: "blurred" | null
      bucket_key?: string
    },
  }
}
const healthWrites = () => mod.settingWrites.filter((w) => w.key === "content_scan_health")

beforeEach(() => {
  db.reset()
  bucketMod.resetBucket()
  mod.resetModeration()
  mod.settings.set("content_scan", { ...DEFAULT_SCAN_SETTINGS, enabled: true })
  resetScanSettingsCache()
  resetScanHealthCache()
  notices.reports.length = 0
  notices.problems.length = 0
  ai.images = 0
  ai.next = {
    kind: "verdict",
    verdict: { decision: "allow", severity: "low", labels: [], explanation: "A chart." },
  }
  auth.user = { id: "user-alice", address: ALICE, handle: null }
})

describe("when the check can't be counted", () => {
  it("refuses the upload with a retryable error while the database is down, storing nothing", async () => {
    mod.faults.scanCount = new Error("Connection terminated unexpectedly")
    mod.faults.setState = new Error("Connection terminated unexpectedly")
    const { res, body } = await upload()
    expect(res.status).toBe(503)
    expect(body.error).toMatch(/Try again/)
    expect(bucketMod.putCalls).toEqual([])
    expect(ai.images).toBe(0)
  })

  it("holds the upload for a moderator when only the count failed, never storing it unchecked", async () => {
    mod.faults.scanCount = new Error("Connection terminated unexpectedly")
    const { res, body } = await upload()
    expect(res.status).toBe(200)
    expect(body.moderation).toBe("blurred")
    expect(ai.images).toBe(0)
    expect(mod.states.get(mod.stateKey("attachment", body.bucket_key!))?.state).toBe("blurred")
    expect(mod.reports).toHaveLength(1)
    expect(mod.reports[0]!.details).toMatchObject({
      explanation: expect.stringContaining("Not checked automatically"),
    })
  })
})

describe("when the setup is broken", () => {
  it("posts the upload, records the failure once and tells moderators once", async () => {
    ai.next = { kind: "unavailable", reason: "API 400", cause: "config", problem: "billing" }
    for (let i = 0; i < 3; i += 1) {
      const { res, body } = await upload()
      expect(res.status).toBe(200)
      expect(body.moderation).toBeNull()
    }
    expect(bucketMod.putCalls.length).toBeGreaterThanOrEqual(3)
    expect(mod.states.size).toBe(0)
    expect(healthWrites()).toHaveLength(1)
    expect(mod.settings.get("content_scan_health")).toMatchObject({
      state: "failing",
      problem: "billing",
    })
    expect(notices.problems).toEqual(["The Anthropic account is out of credit."])

    // The next check that gets an answer clears it.
    ai.next = {
      kind: "verdict",
      verdict: { decision: "allow", severity: "low", labels: [], explanation: "A chart." },
    }
    await upload()
    expect(mod.settings.get("content_scan_health")).toMatchObject({ state: "ok" })
    expect(healthWrites()).toHaveLength(2)
  })

  it("leaves the record alone during an ordinary outage", async () => {
    ai.next = { kind: "unavailable", reason: "API 529", cause: "outage" }
    expect((await upload()).res.status).toBe(200)
    expect(healthWrites()).toEqual([])
    expect(notices.problems).toEqual([])
  })
})

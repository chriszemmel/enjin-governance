/**
 * POST /api/security-disclosures: public, unauthenticated. The real route,
 * the real schema / honeypot, the real persistence module
 * (lib/db/security-disclosures, over a recording fake SQL client), the real
 * Telegram fan-out (over a recording fake fetch) and the real in-process rate
 * limiter run. Nothing leaves the process.
 */
import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type * as RateLimit from "@/lib/rate-limit"

const env = vi.hoisted(() => ({
  TELEGRAM_BOT_TOKEN: "bot-token" as string | undefined,
  TELEGRAM_CHAT_ID: "-100security" as string | undefined,
}))
const io = vi.hoisted(() => ({
  dbConfigured: true,
  dbError: null as Error | null,
  /** Every statement run against the fake SQL client: text + bound values. */
  queries: [] as Array<{ text: string; values: unknown[] }>,
  sent: [] as Array<{ url: string; body: { chat_id: string; text: string } }>,
  telegram: "ok" as "ok" | "500" | "throw",
}))

vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => io.dbConfigured,
  getSql:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (io.dbError) throw io.dbError
      io.queries.push({ text: strings.join("$"), values })
      return [{ id: `00000000-0000-4000-8000-00000000000${io.queries.length}` }]
    },
}))
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof RateLimit>()
  return { ...real, enforceRateLimit: vi.fn(real.enforceRateLimit) }
})

import { __resetRateLimitStore, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { HONEYPOT_FIELD } from "@/lib/security/disclosure"
import { POST } from "@/app/api/security-disclosures/route"

const IP = "203.0.113.50"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const report = (over: Record<string, unknown> = {}) => ({
  severity: "high",
  category: "Auth / API / backend",
  summary: "Session cookie readable from JS",
  details: "Steps: sign in, open the console, read document.cookie.",
  contact: "researcher@example.org",
  network: "enjin-relay",
  ...over,
})

function submit(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("https://gov.test/api/security-disclosures", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `${IP}, 10.0.0.1`,
        "user-agent": "vitest-reporter",
        ...headers,
      },
    }),
  )
}

beforeEach(() => {
  env.TELEGRAM_BOT_TOKEN = "bot-token"
  env.TELEGRAM_CHAT_ID = "-100security"
  io.dbConfigured = true
  io.dbError = null
  io.queries.length = 0
  io.sent.length = 0
  io.telegram = "ok"
  __resetRateLimitStore()
  vi.mocked(enforceRateLimit).mockClear()
  for (const k of [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]) {
    vi.stubEnv(k, "")
  }
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    if (!url.startsWith("https://api.telegram.org/")) throw new Error(`unexpected fetch ${url}`)
    if (io.telegram === "throw") throw new Error("network down")
    io.sent.push({ url, body: JSON.parse(init.body) })
    return new Response("{}", { status: io.telegram === "500" ? 500 : 200 })
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("POST /api/security-disclosures", () => {
  it("stores the report with a hash of the IP (never the IP) and notifies the security chat", async () => {
    const res = await submit(report())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, id: expect.stringMatching(UUID) })

    expect(io.queries).toHaveLength(1)
    const { text, values } = io.queries[0]
    expect(text).toContain("INSERT INTO security_disclosures")
    expect(values).toContain(createHash("sha256").update(IP).digest("hex"))
    expect(values).toContain("vitest-reporter")
    expect(JSON.stringify(values)).not.toContain(IP)

    expect(io.sent).toHaveLength(1)
    expect(io.sent[0].url).toBe("https://api.telegram.org/botbot-token/sendMessage")
    expect(io.sent[0].body.chat_id).toBe("-100security")
    expect(io.sent[0].body.text).toContain("[HIGH]")
    expect(io.sent[0].body.text).toContain(`Ref: ${body.id}`)
    // The reporter's IP doesn't go to the chat either.
    expect(io.sent[0].body.text).not.toContain(IP)
  })

  it('without a client IP header the stored IP hash is null, not a hash of "unknown"', async () => {
    const res = await submit(report(), { "x-forwarded-for": "" })
    expect(res.status).toBe(200)
    expect(io.queries[0].values).not.toContain(createHash("sha256").update("unknown").digest("hex"))
    expect(io.queries[0].values).toContain(null)
  })

  it("a filled honeypot looks like success but stores and sends nothing", async () => {
    const res = await submit(report({ [HONEYPOT_FIELD]: "https://spam.example" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, id: expect.stringMatching(UUID) })
    expect(io.queries).toEqual([])
    expect(io.sent).toEqual([])

    // Even an otherwise invalid bot body gets the same quiet success.
    const junk = await submit({ [HONEYPOT_FIELD]: "x", summary: "" })
    expect(junk.status).toBe(200)
    expect(io.queries).toEqual([])
  })

  it("an empty or whitespace honeypot is a normal submission", async () => {
    for (const website of ["", "   "]) {
      expect((await submit(report({ [HONEYPOT_FIELD]: website }))).status).toBe(200)
    }
    expect(io.queries).toHaveLength(2)
    // The decoy field itself is never persisted.
    expect(JSON.stringify(io.queries)).not.toContain(HONEYPOT_FIELD)
  })

  it("validates severity, lengths and types, storing nothing on a bad report", async () => {
    for (const over of [
      { severity: "urgent" },
      { severity: undefined },
      { summary: "short" },
      { summary: "x".repeat(201) },
      { details: "too short" },
      { details: "x".repeat(10_001) },
      { details: `${" ".repeat(30)}tiny${" ".repeat(30)}` },
      { category: "x".repeat(61) },
      { contact: "x".repeat(201) },
      { network: "x".repeat(41) },
      { summary: 12345678 },
    ]) {
      // Fresh budget each time so the cap (tested below) doesn't mask a 400.
      __resetRateLimitStore()
      const res = await submit(report(over))
      expect(res.status, JSON.stringify(over)).toBe(400)
    }
    expect((await submit("{not json")).status).toBe(400)
    expect((await submit("null")).status).toBe(400)
    expect(io.queries).toEqual([])
    expect(io.sent).toEqual([])
  })

  it("accepts a report exactly at the caps", async () => {
    const res = await submit(
      report({ summary: "s".repeat(200), details: "d".repeat(10_000), contact: "c".repeat(200) }),
    )
    expect(res.status).toBe(200)
  })

  it("is rate limited per IP: the 6th report in 10 minutes gets 429 and is not stored", async () => {
    for (let i = 0; i < RATE_LIMITS.securityDisclosure.limit; i += 1) {
      expect((await submit(report())).status).toBe(200)
    }
    const res = await submit(report())
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(io.queries).toHaveLength(RATE_LIMITS.securityDisclosure.limit)
    expect(io.sent).toHaveLength(RATE_LIMITS.securityDisclosure.limit)
    expect(vi.mocked(enforceRateLimit).mock.calls[0][0]).toEqual({
      ...RATE_LIMITS.securityDisclosure,
      identity: IP,
    })
    // Honeypot hits count against the same budget, so bots can't probe freely.
    expect((await submit(report({ [HONEYPOT_FIELD]: "x" }))).status).toBe(429)
    expect((await submit(report(), { "x-forwarded-for": "198.51.100.77" })).status).toBe(200)
  })

  it("a Telegram failure or missing Telegram config never fails a stored report", async () => {
    for (const mode of ["500", "throw"] as const) {
      io.telegram = mode
      expect((await submit(report())).status).toBe(200)
    }
    io.telegram = "ok"
    env.TELEGRAM_BOT_TOKEN = undefined
    const attempts = io.sent.length
    expect((await submit(report())).status).toBe(200)
    expect(io.queries).toHaveLength(3)
    // Without a bot token nothing is sent at all.
    expect(io.sent).toHaveLength(attempts)
  })

  it("does not notify anyone when the report could not be stored", async () => {
    io.dbError = new Error('relation "security_disclosures" does not exist')
    await expect(submit(report())).rejects.toThrow()
    expect(io.sent).toEqual([])
  })

  it("answers 503 with a generic message when the database is not configured", async () => {
    io.dbConfigured = false
    const res = await submit(report())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: "Reporting is temporarily unavailable." })
    expect(io.sent).toEqual([])
  })
})

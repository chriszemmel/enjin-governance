/**
 * The admins' Status tab: GET /api/moderation/status and POST
 * /api/moderation/status/test-message. Admins only; the report carries
 * booleans and labels, never a secret (token, key, password, or a URL with
 * credentials), not even when a failure's error message contains one; the
 * test message goes out at most once a minute across servers. Real route
 * handlers, the real role check and the real checks; only I/O (session,
 * database, bucket, Telegram) and the environment are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ADMIN = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const MOD = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const USER = "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH"

const DATABASE_URL =
  "postgres://neondb_owner:db-secret-pw@ep-cool-1.eu-central-1.aws.neon.tech/neondb"
const KV_URL = "https://kvuser:kv-secret-pw@eu1-kv.upstash.io"

const env = vi.hoisted(() => ({
  GOVERNANCE_ADMIN_PUBLIC_KEYS: "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA",
  DATABASE_URL: "postgres://neondb_owner:db-secret-pw@ep-cool-1.eu-central-1.aws.neon.tech/neondb",
  NEXT_PUBLIC_APP_URL: "https://gov.example",
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "wc-project-0123456789abcdef" as string | undefined,
  TELEGRAM_BOT_TOKEN: "7700112233:tg-secret-token-AAE" as string | undefined,
  TELEGRAM_CHAT_ID: "-1009990001" as string | undefined,
  TELEGRAM_MODERATION_CHAT_ID: "-1009990002" as string | undefined,
  ANTHROPIC_API_KEY: "sk-ant-api03-secret-key" as string | undefined,
  R2_ACCOUNT_ID: "r2-account-secret" as string | undefined,
  R2_ACCESS_KEY_ID: "r2-access-key-id-secret" as string | undefined,
  R2_SECRET_ACCESS_KEY: "r2-secret-access-key" as string | undefined,
  R2_ENDPOINT: "https://r2-account-secret.r2.cloudflarestorage.com" as string | undefined,
  R2_PUBLIC_URL: "https://pub-secret.r2.dev" as string | undefined,
  SITE_PASSWORD: "gate-secret-pw",
  LEGAL_OPERATOR_NAME: "Jane Operator" as string | undefined,
  LEGAL_OPERATOR_ADDRESS: "Secret Street 1 | 12345 Hidden City" as string | undefined,
  LEGAL_CONTACT_EMAIL: "operator@private.example",
}))
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; address: string; handle: string | null },
}))
const infra = vi.hoisted(() => ({ db: true, r2: true, refused: false }))
const telegram = vi.hoisted(() => ({
  status: 200,
  calls: [] as { url: string; body: { chat_id: string; text: string } }[],
}))

vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => auth.user }))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => infra.db,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/r2/client", () => ({
  isR2Configured: () => infra.r2,
  isPublicUrlMisconfigured: () => infra.refused,
}))
vi.mock("@/lib/db/moderation", async () => await import("./fake-moderation"))

import * as mod from "./fake-moderation"
import { publicKeyOf } from "@/lib/chain/ss58"
import { noteScanHealth, resetScanHealthCache } from "@/lib/moderation/scan-health"
import { resetSlots } from "@/lib/moderation/slots"
import { GET as STATUS } from "@/app/api/moderation/status/route"
import { POST as TEST_MESSAGE } from "@/app/api/moderation/status/test-message/route"

type Item = { id: string; label: string; level: string; hint: string }
type Report = {
  ok: boolean
  checked_at: string
  production: boolean
  sections: { id: string; title: string; items: Item[] }[]
  health: { problem: string; first_seen: string; last_seen: string } | null
  can_send_test: boolean
}

/** Every value that must never reach the browser. */
const SECRETS = [
  DATABASE_URL,
  "db-secret-pw",
  "neondb_owner",
  KV_URL,
  "kv-secret-pw",
  "kv-secret-token",
  "7700112233",
  "tg-secret-token",
  "-1009990001",
  "-1009990002",
  "sk-ant-api03-secret-key",
  "r2-account-secret",
  "r2-access-key-id-secret",
  "r2-secret-access-key",
  "pub-secret.r2.dev",
  "gate-secret-pw",
  "Jane Operator",
  "Secret Street",
  "operator@private.example",
  "wc-project-0123456789abcdef",
]
function expectNoSecrets(raw: string) {
  for (const s of SECRETS) expect(raw).not.toContain(s)
  // No URL with credentials, and no connection string of any kind.
  expect(raw).not.toMatch(/[a-z]+:\/\/[^/\s"@]*:[^/\s"@]*@/i)
  expect(raw).not.toMatch(/postgres(ql)?:\/\//i)
}

const signIn = (address: string | null) => {
  auth.user = address ? { id: `user-${address.slice(0, 6)}`, address, handle: null } : null
}
async function status() {
  const res = await STATUS()
  const raw = await res.text()
  return { res, raw, body: JSON.parse(raw) as Report }
}
const itemOf = (r: Report, id: string) =>
  r.sections.flatMap((s) => s.items).find((i) => i.id === id)!
async function send() {
  const res = await TEST_MESSAGE()
  const raw = await res.text()
  return { res, raw, body: JSON.parse(raw) as { ok: boolean; error?: string } }
}

const snapshot = { ...env }

beforeEach(() => {
  Object.assign(env, snapshot)
  mod.resetModeration()
  mod.roles.set(`0x${publicKeyOf(MOD)}`, {
    role: "moderator",
    granted_by: null,
    created_at: new Date(0),
  })
  mod.settings.set("content_scan", {
    enabled: true,
    model: "claude-haiku-4-5",
    images: true,
    pdfs: true,
    proposals: true,
    comments: true,
    onClearViolation: "reject",
    dailyLimit: 300,
  })
  infra.db = true
  infra.r2 = true
  infra.refused = false
  telegram.status = 200
  telegram.calls = []
  resetSlots()
  resetScanHealthCache()
  signIn(null)
  vi.stubEnv("VERCEL_ENV", "production")
  vi.stubEnv("KV_REST_API_URL", KV_URL)
  vi.stubEnv("KV_REST_API_TOKEN", "kv-secret-token")
  vi.stubEnv("LEGAL_CONTACT_EMAIL", env.LEGAL_CONTACT_EMAIL)
  vi.stubEnv("NEXT_PUBLIC_APP_URL", env.NEXT_PUBLIC_APP_URL)
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    telegram.calls.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ ok: telegram.status === 200 }), {
      status: telegram.status,
    })
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("status report", () => {
  it("is for admins only", async () => {
    expect((await STATUS()).status).toBe(401)
    for (const who of [USER, MOD]) {
      signIn(who)
      const res = await STATUS()
      expect(res.status).toBe(403)
      expect(await res.text()).not.toContain("sections")
    }
  })

  it("checks everything and reveals nothing but labels", async () => {
    signIn(ADMIN)
    const { res, raw, body } = await status()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(body.production).toBe(true)
    expect(body.sections.map((s) => s.id)).toEqual([
      "database",
      "storage",
      "rate-limit",
      "telegram",
      "scan",
      "legal",
      "wallet",
    ])
    const items = body.sections.flatMap((s) => s.items)
    for (const i of items) {
      expect(Object.keys(i).sort()).toEqual(["hint", "id", "label", "level"])
      expect(["ok", "warning", "problem"]).toContain(i.level)
    }
    expect(items.filter((i) => i.level !== "ok")).toEqual([])
    expect(itemOf(body, "app-url").hint).toBe("File links use https://gov.example/r.")
    expect(itemOf(body, "scan-today").hint).toBe("0 of 300.")
    expect(body.can_send_test).toBe(true)
    expect(body.health).toBeNull()
    expectNoSecrets(raw)
  })

  it("stays free of secrets when checks fail, even when an error names one", async () => {
    signIn(ADMIN)
    mod.faults.ping = new Error(`connect ECONNREFUSED ${DATABASE_URL}`)
    vi.stubEnv("KV_REST_API_URL", "")
    vi.stubEnv("KV_REST_API_TOKEN", "")
    vi.stubEnv("LEGAL_CONTACT_EMAIL", "")
    env.TELEGRAM_BOT_TOKEN = undefined
    env.R2_SECRET_ACCESS_KEY = undefined
    infra.r2 = false
    infra.refused = true
    const { raw, body } = await status()
    expect(itemOf(body, "database").level).toBe("problem")
    expect(itemOf(body, "migration-012").level).toBe("warning")
    expect(itemOf(body, "storage").hint).toContain("Missing: R2_SECRET_ACCESS_KEY.")
    expect(itemOf(body, "app-url").level).toBe("problem")
    expect(itemOf(body, "rate-limit").level).toBe("warning")
    expect(itemOf(body, "telegram-token").level).toBe("warning")
    expect(itemOf(body, "legal-email").level).toBe("problem")
    expect(itemOf(body, "scan-enabled").level).toBe("warning")
    expect(body.can_send_test).toBe(false)
    expectNoSecrets(raw)

    mod.faults.ping = null
    mod.faults.schema = new Error(`permission denied (${DATABASE_URL})`)
    mod.faults.settings = new Error(`timeout: ${DATABASE_URL}`)
    const again = await status()
    expect(itemOf(again.body, "database").level).toBe("ok")
    expect(itemOf(again.body, "migration-011").level).toBe("warning")
    expect(itemOf(again.body, "scan-health").level).toBe("warning")
    expectNoSecrets(again.raw)
  })

  it("finds migrations applied by hand, and ones that are missing", async () => {
    signIn(ADMIN)
    mod.schema.ledger = null
    mod.schema.keepState = false
    const { body } = await status()
    expect(itemOf(body, "migration-011")).toMatchObject({ level: "ok" })
    expect(itemOf(body, "migration-011").hint).toContain("by hand")
    expect(itemOf(body, "migration-013")).toMatchObject({ level: "problem" })
  })

  it("shows a broken content-check setup until a check works again", async () => {
    signIn(ADMIN)
    await noteScanHealth({
      kind: "unavailable",
      reason: "API 401",
      cause: "config",
      problem: "api_key",
    })
    const bad = (await status()).body
    expect(itemOf(bad, "scan-health").level).toBe("problem")
    expect(bad.health?.problem).toBe("The API key was refused. Check ANTHROPIC_API_KEY.")
    // Moderators were told, in their own chat.
    expect(telegram.calls.map((c) => c.body.chat_id)).toEqual(["-1009990002"])
    expect(telegram.calls[0]!.body.text).toContain("Automatic content checks are failing")

    await noteScanHealth({
      kind: "verdict",
      verdict: { decision: "allow", severity: "low", labels: [], explanation: "Fine." },
    })
    const good = (await status()).body
    expect(itemOf(good, "scan-health").level).toBe("ok")
    expect(good.health).toBeNull()
  })
})

describe("test message", () => {
  it("is for admins only, and sends nothing for anyone else", async () => {
    expect((await TEST_MESSAGE()).status).toBe(401)
    for (const who of [USER, MOD]) {
      signIn(who)
      expect((await TEST_MESSAGE()).status).toBe(403)
    }
    expect(telegram.calls).toEqual([])
    expect(mod.slots.size).toBe(0)
  })

  it("goes to the moderation chat at most once a minute, across servers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-26T09:00:00Z"))
    signIn(ADMIN)
    const first = await send()
    expect(first.res.status).toBe(200)
    expect(telegram.calls).toHaveLength(1)
    expect(telegram.calls[0]!.body.chat_id).toBe("-1009990002")
    expectNoSecrets(first.raw)

    vi.setSystemTime(new Date("2026-09-26T09:00:30Z"))
    const second = await send()
    expect(second.res.status).toBe(429)
    expect(second.res.headers.get("Retry-After")).toBe("60")
    // Another server: nothing in memory, but the database remembers.
    resetSlots()
    expect((await send()).res.status).toBe(429)
    expect(telegram.calls).toHaveLength(1)

    vi.setSystemTime(new Date("2026-09-26T09:01:01Z"))
    expect((await send()).res.status).toBe(200)
    expect(telegram.calls).toHaveLength(2)
  })

  it("still holds to once a minute per server while the database is down", async () => {
    signIn(ADMIN)
    mod.faults.slots = new Error("db down")
    expect((await send()).res.status).toBe(200)
    expect((await send()).res.status).toBe(429)
    expect(telegram.calls).toHaveLength(1)
  })

  it("says why Telegram refused, in its own words and without the token", async () => {
    signIn(ADMIN)
    telegram.status = 403
    const { res, raw, body } = await send()
    expect(res.status).toBe(502)
    expect(body.error).toBe("The bot can't post in that chat. Add it to the chat, or unblock it.")
    expectNoSecrets(raw)
  })

  it("doesn't use up the minute when there is nowhere to send", async () => {
    signIn(ADMIN)
    env.TELEGRAM_MODERATION_CHAT_ID = "OFF"
    expect((await send()).res.status).toBe(409)
    env.TELEGRAM_MODERATION_CHAT_ID = undefined
    env.TELEGRAM_CHAT_ID = undefined
    expect((await send()).res.status).toBe(409)
    env.TELEGRAM_CHAT_ID = "-1009990001"
    env.TELEGRAM_BOT_TOKEN = undefined
    expect((await send()).res.status).toBe(409)
    expect(mod.slots.size).toBe(0)
    expect(telegram.calls).toEqual([])
  })
})

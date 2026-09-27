import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_APP_URL: "https://gov.example/",
  TELEGRAM_BOT_TOKEN: "bot-token" as string | undefined,
  TELEGRAM_CHAT_ID: "-100security" as string | undefined,
  TELEGRAM_MODERATION_CHAT_ID: undefined as string | undefined,
}))
vi.mock("@/lib/env", () => ({ env }))
const gate = vi.hoisted(() => ({
  open: 1,
  allowed: true,
  /** Slots claimed in the shared database: key -> when. */
  slots: new Map<string, number>(),
  slotsDown: false,
}))
vi.mock("@/lib/db/moderation", () => ({
  openReportCount: async () => gate.open,
  claimSettingSlot: async (key: string, seconds: number) => {
    if (gate.slotsDown) throw new Error("db down")
    const last = gate.slots.get(key)
    if (last !== undefined && Date.now() - last < seconds * 1000) return false
    gate.slots.set(key, Date.now())
    return true
  },
}))
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { moderationNotice: {} },
  enforceRateLimit: async () => ({ allowed: gate.allowed }),
}))

import {
  formatReportNotice,
  formatScanProblemNotice,
  moderationChat,
  notifyNewReport,
  notifyScanProblem,
  sendModerationTestMessage,
} from "@/lib/moderation/notify"
import { resetSlots } from "@/lib/moderation/slots"

const notice = {
  targetId: "c1",
  targetType: "comment" as const,
  category: "scam" as const,
  severity: "medium" as const,
  source: "user" as const,
  network: "enjin-relay",
  referendumIndex: 214,
}

const sent: { url: string; body: { chat_id: string; text: string } }[] = []
const telegram = { status: 200 }

function reset() {
  sent.length = 0
  telegram.status = 200
  env.TELEGRAM_BOT_TOKEN = "bot-token"
  env.TELEGRAM_CHAT_ID = "-100security"
  env.TELEGRAM_MODERATION_CHAT_ID = undefined
  gate.open = 1
  gate.allowed = true
  gate.slots.clear()
  gate.slotsDown = false
  resetSlots()
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) })
    return new Response("{}", { status: telegram.status })
  })
}

describe("moderation Telegram notice", () => {
  beforeEach(() => {
    reset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("says what and where, with a link to the queue", () => {
    expect(formatReportNotice(notice, "https://gov.example/")).toBe(
      [
        "New moderation report - medium severity",
        "Scam or phishing · Comment on referendum #214 (enjin-relay)",
        "Flagged by a user",
        "Review: https://gov.example/moderation",
      ].join("\n"),
    )
    expect(
      formatReportNotice(
        { ...notice, source: "automatic", network: null, referendumIndex: null },
        "https://gov.example",
      ),
    ).toContain("Scam or phishing · Comment\nFlagged by the automatic check")
  })

  it("goes to the moderation chat, or the security chat when none is set", async () => {
    await notifyNewReport(notice)
    expect(sent[0]!.body.chat_id).toBe("-100security")
    expect(sent[0]!.url).toBe("https://api.telegram.org/botbot-token/sendMessage")
    env.TELEGRAM_MODERATION_CHAT_ID = "-100mods"
    await notifyNewReport(notice)
    expect(sent[1]!.body.chat_id).toBe("-100mods")
  })

  it("sends one notice per item, and stops at the hourly ceiling", async () => {
    gate.open = 2 // someone already reported this item
    await notifyNewReport(notice)
    gate.open = 1
    gate.allowed = false
    await notifyNewReport(notice)
    expect(sent).toHaveLength(0)
  })

  it("stays quiet when switched off or not configured, and never throws", async () => {
    env.TELEGRAM_MODERATION_CHAT_ID = "OFF"
    await notifyNewReport(notice)
    env.TELEGRAM_MODERATION_CHAT_ID = undefined
    env.TELEGRAM_BOT_TOKEN = undefined
    await notifyNewReport(notice)
    expect(sent).toHaveLength(0)

    env.TELEGRAM_BOT_TOKEN = "bot-token"
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down")
    })
    await expect(notifyNewReport(notice)).resolves.toBeUndefined()
  })
})

describe("the moderators' chat", () => {
  beforeEach(() => reset())
  afterEach(() => vi.unstubAllGlobals())

  it("is their own, the security chat, off, or none", () => {
    expect(moderationChat()).toEqual({ kind: "security", id: "-100security" })
    env.TELEGRAM_MODERATION_CHAT_ID = " -100mods "
    expect(moderationChat()).toEqual({ kind: "own", id: "-100mods" })
    env.TELEGRAM_MODERATION_CHAT_ID = "off"
    expect(moderationChat()).toEqual({ kind: "off", id: null })
    env.TELEGRAM_MODERATION_CHAT_ID = undefined
    env.TELEGRAM_CHAT_ID = undefined
    expect(moderationChat()).toEqual({ kind: "none", id: null })
  })
})

describe("content-check alert", () => {
  const DAY = 24 * 60 * 60_000
  const problem = "The Anthropic account is out of credit."

  beforeEach(() => {
    reset()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-26T09:00:00Z"))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("says what is wrong and where to look", () => {
    expect(formatScanProblemNotice(problem, "https://gov.example/")).toBe(
      [
        "Automatic content checks are failing",
        problem,
        "Uploads are posted without a check until this is fixed.",
        "Status: https://gov.example/moderation (Status tab)",
      ].join("\n"),
    )
  })

  it("goes out at most once a day, across servers", async () => {
    env.TELEGRAM_MODERATION_CHAT_ID = "-100mods"
    await notifyScanProblem(problem)
    expect(sent.map((m) => m.body.chat_id)).toEqual(["-100mods"])
    expect(sent[0]!.body.text).toContain(problem)

    vi.setSystemTime(new Date("2026-09-26T20:00:00Z"))
    await notifyScanProblem("The API key was refused.")
    // Another server, with nothing in memory: the shared slot still holds.
    resetSlots()
    await notifyScanProblem(problem)
    expect(sent).toHaveLength(1)

    vi.setSystemTime(new Date(Date.parse("2026-09-26T09:00:00Z") + DAY))
    await notifyScanProblem(problem)
    expect(sent).toHaveLength(2)
  })

  it("still goes out at most once a day per server while the database is down", async () => {
    gate.slotsDown = true
    await notifyScanProblem(problem)
    await notifyScanProblem(problem)
    expect(sent).toHaveLength(1)
  })

  it("isn't sent, and uses up nothing, while notices are off or unconfigured", async () => {
    env.TELEGRAM_MODERATION_CHAT_ID = "OFF"
    await notifyScanProblem(problem)
    env.TELEGRAM_MODERATION_CHAT_ID = undefined
    env.TELEGRAM_BOT_TOKEN = undefined
    await notifyScanProblem(problem)
    expect(sent).toHaveLength(0)
    expect(gate.slots.size).toBe(0)
    env.TELEGRAM_BOT_TOKEN = "bot-token"
    await notifyScanProblem(problem)
    expect(sent).toHaveLength(1)
  })
})

describe("test message", () => {
  beforeEach(() => reset())
  afterEach(() => vi.unstubAllGlobals())

  it("goes to the moderators' chat and says why it failed", async () => {
    env.TELEGRAM_MODERATION_CHAT_ID = "-100mods"
    expect(await sendModerationTestMessage()).toEqual({ ok: true })
    expect(sent[0]!.body).toMatchObject({ chat_id: "-100mods" })
    expect(sent[0]!.body.text).toContain("Test message")

    for (const [status, reason] of [
      [401, "bad_token"],
      [400, "chat_not_found"],
      [403, "not_allowed"],
      [429, "rate_limited"],
      [500, "error"],
    ] as const) {
      telegram.status = status
      expect(await sendModerationTestMessage()).toEqual({ ok: false, reason })
    }
    vi.stubGlobal("fetch", async () => {
      throw new Error("getaddrinfo ENOTFOUND api.telegram.org/botbot-token")
    })
    expect(await sendModerationTestMessage()).toEqual({ ok: false, reason: "unreachable" })
  })

  it("isn't sent while notices are off or unconfigured", async () => {
    env.TELEGRAM_MODERATION_CHAT_ID = "OFF"
    expect(await sendModerationTestMessage()).toEqual({ ok: false, reason: "off" })
    env.TELEGRAM_MODERATION_CHAT_ID = undefined
    env.TELEGRAM_BOT_TOKEN = undefined
    expect(await sendModerationTestMessage()).toEqual({ ok: false, reason: "not_configured" })
    expect(sent).toHaveLength(0)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_APP_URL: "https://gov.example/",
  TELEGRAM_BOT_TOKEN: "bot-token" as string | undefined,
  TELEGRAM_CHAT_ID: "-100security" as string | undefined,
  TELEGRAM_MODERATION_CHAT_ID: undefined as string | undefined,
}))
vi.mock("@/lib/env", () => ({ env }))
const gate = vi.hoisted(() => ({ open: 1, allowed: true }))
vi.mock("@/lib/db/moderation", () => ({ openReportCount: async () => gate.open }))
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { moderationNotice: {} },
  enforceRateLimit: async () => ({ allowed: gate.allowed }),
}))

import { formatReportNotice, notifyNewReport } from "@/lib/moderation/notify"

const notice = {
  targetId: "c1",
  targetType: "comment" as const,
  category: "scam" as const,
  severity: "medium" as const,
  source: "user" as const,
  network: "enjin-relay",
  referendumIndex: 214,
}

describe("moderation Telegram notice", () => {
  const sent: { url: string; body: { chat_id: string; text: string } }[] = []

  beforeEach(() => {
    sent.length = 0
    env.TELEGRAM_BOT_TOKEN = "bot-token"
    env.TELEGRAM_CHAT_ID = "-100security"
    env.TELEGRAM_MODERATION_CHAT_ID = undefined
    gate.open = 1
    gate.allowed = true
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) })
      return new Response("{}", { status: 200 })
    })
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

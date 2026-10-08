/**
 * POST /api/moderation/status/test-message (admins)
 *
 * Sends a test message to the moderators' Telegram chat, at most once a
 * minute across all admins and servers.
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth/roles"
import { env } from "@/lib/env"
import { moderationChat, sendModerationTestMessage } from "@/lib/moderation/notify"
import { claimSlot } from "@/lib/moderation/slots"
import type { TelegramFailure } from "@/lib/telegram/send"

export const runtime = "nodejs"

const WINDOW_MS = 60_000

const FAILURES: Record<TelegramFailure | "off", { status: number; error: string }> = {
  off: { status: 409, error: "Moderation notices are switched off (OFF)." },
  not_configured: {
    status: 409,
    error: "Telegram isn't set up. Set TELEGRAM_BOT_TOKEN and a chat id.",
  },
  bad_token: { status: 502, error: "Telegram refused the bot token." },
  chat_not_found: { status: 502, error: "Telegram couldn't find the chat. Check the chat id." },
  not_allowed: {
    status: 502,
    error: "The bot can't post in that chat. Add it to the chat, or unblock it.",
  },
  rate_limited: { status: 502, error: "Telegram is rate limiting the bot. Try again later." },
  unreachable: { status: 502, error: "Telegram couldn't be reached." },
  error: { status: 502, error: "Telegram didn't accept the message." },
}

const fail = (reason: TelegramFailure | "off") =>
  NextResponse.json(
    { ok: false, error: FAILURES[reason].error },
    { status: FAILURES[reason].status },
  )

export async function POST(): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin

  // Nothing to send to: say so without using up the minute.
  const chat = moderationChat()
  if (chat.kind === "off") return fail("off")
  if (!chat.id || !env.TELEGRAM_BOT_TOKEN) return fail("not_configured")

  if (!(await claimSlot("telegram_test", WINDOW_MS, admin.publicKey))) {
    return NextResponse.json(
      { ok: false, error: "One test message a minute. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(WINDOW_MS / 1000) } },
    )
  }
  const sent = await sendModerationTestMessage()
  return sent.ok ? NextResponse.json({ ok: true }) : fail(sent.reason)
}

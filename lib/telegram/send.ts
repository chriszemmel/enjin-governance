/**
 * Plain-text message to a Telegram chat through the bot in
 * TELEGRAM_BOT_TOKEN. Best-effort: notifications are never critical, so a
 * missing config, a timeout or an API error only returns false.
 *
 * The request URL carries the bot token, so an error is only ever reported
 * as one of the fixed reasons below - never as the error's own message.
 */

import "server-only"
import { env } from "@/lib/env"

/** Why a message wasn't delivered; safe to show to admins. */
export type TelegramFailure =
  | "not_configured"
  | "bad_token"
  | "chat_not_found"
  | "not_allowed"
  | "rate_limited"
  | "unreachable"
  | "error"

type TelegramResult = { ok: true } | { ok: false; reason: TelegramFailure }

function failureFor(status: number): TelegramFailure {
  if (status === 401 || status === 404) return "bad_token"
  if (status === 400) return "chat_not_found"
  if (status === 403) return "not_allowed"
  if (status === 429) return "rate_limited"
  return "error"
}

/** Send, and say why it failed. Never throws. */
export async function postTelegramMessage(
  chatId: string | undefined,
  text: string,
): Promise<TelegramResult> {
  const token = env.TELEGRAM_BOT_TOKEN
  if (!token || !chatId) return { ok: false, reason: "not_configured" }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok ? { ok: true } : { ok: false, reason: failureFor(res.status) }
  } catch {
    return { ok: false, reason: "unreachable" }
  }
}

export async function sendTelegramMessage(
  chatId: string | undefined,
  text: string,
): Promise<boolean> {
  return (await postTelegramMessage(chatId, text)).ok
}

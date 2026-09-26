/**
 * Plain-text message to a Telegram chat through the bot in
 * TELEGRAM_BOT_TOKEN. Best-effort: notifications are never critical, so a
 * missing config, a timeout or an API error only returns false.
 */

import "server-only"
import { env } from "@/lib/env"

export async function sendTelegramMessage(
  chatId: string | undefined,
  text: string,
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN
  if (!token || !chatId) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}

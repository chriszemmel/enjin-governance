/**
 * Optional fan-out of a new security disclosure to a Telegram chat (e.g. a
 * shared Enjin team group). Best-effort: the report is already persisted before
 * this runs, so a Telegram failure (or no config) never fails the request.
 *
 * Enable by setting TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID
 * (the group/chat id). Unset = disclosures live in the DB only.
 */

import "server-only"
import { env } from "@/lib/env"
import { formatDisclosureMessage, type DisclosureInput } from "./disclosure"

export async function notifySecurityDisclosure(
  input: DisclosureInput,
  id: string,
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN
  const chatId = env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatDisclosureMessage(input, id),
        disable_web_page_preview: true,
      }),
    })
  } catch {
    // swallow - durable copy is in the DB; notifications are non-critical
  }
}

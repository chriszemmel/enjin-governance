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
import { sendTelegramMessage } from "@/lib/telegram/send"
import { formatDisclosureMessage, type DisclosureInput } from "./disclosure"

export async function notifySecurityDisclosure(input: DisclosureInput, id: string): Promise<void> {
  // Durable copy is in the DB; the notification is non-critical.
  await sendTelegramMessage(env.TELEGRAM_CHAT_ID, formatDisclosureMessage(input, id))
}

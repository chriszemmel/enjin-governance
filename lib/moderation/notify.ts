/**
 * Telegram notice for new moderation reports, so moderators don't have to
 * watch the queue. Goes to TELEGRAM_MODERATION_CHAT_ID, or TELEGRAM_CHAT_ID
 * when that is unset; "OFF" turns it off.
 *
 * One notice per item: further reports on an item that is already in
 * the queue add nothing new. A global ceiling keeps a flood of reports
 * from flooding the chat. The notice only says where to look - never who
 * reported, their note or the content itself.
 */

import "server-only"
import { openReportCount } from "@/lib/db/moderation"
import { env } from "@/lib/env"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { sendTelegramMessage } from "@/lib/telegram/send"
import { REPORT_CATEGORY_LABELS, type ModerationTarget, type ReportCategory } from "./policy"

type ReportNotice = {
  targetType: ModerationTarget
  category: ReportCategory
  severity: "low" | "medium" | "high"
  source: "user" | "automatic"
  network: string | null
  referendumIndex: number | null
}

const NOUN: Record<ModerationTarget, string> = {
  proposal: "Proposal text",
  attachment: "Attachment",
  comment: "Comment",
}

/** Pure: the text of the notice. */
export function formatReportNotice(n: ReportNotice, appUrl: string): string {
  const where = [
    n.referendumIndex != null ? `on referendum #${n.referendumIndex}` : null,
    n.network ? `(${n.network})` : null,
  ]
    .filter(Boolean)
    .join(" ")
  return [
    `New moderation report - ${n.severity} severity`,
    `${REPORT_CATEGORY_LABELS[n.category]} · ${NOUN[n.targetType]}${where ? ` ${where}` : ""}`,
    `Flagged by ${n.source === "automatic" ? "the automatic check" : "a user"}`,
    `Review: ${appUrl.replace(/\/+$/, "")}/moderation`,
  ].join("\n")
}

/** Best-effort; never throws. */
export async function notifyNewReport(n: ReportNotice & { targetId: string }): Promise<void> {
  const chat = env.TELEGRAM_MODERATION_CHAT_ID ?? env.TELEGRAM_CHAT_ID
  if (!chat || chat.trim().toUpperCase() === "OFF" || !env.TELEGRAM_BOT_TOKEN) return
  try {
    if ((await openReportCount(n.targetType, n.targetId)) > 1) return
    const rl = await enforceRateLimit({ ...RATE_LIMITS.moderationNotice, identity: "all" })
    if (!rl.allowed) return
  } catch {
    return
  }
  await sendTelegramMessage(chat, formatReportNotice(n, env.NEXT_PUBLIC_APP_URL))
}

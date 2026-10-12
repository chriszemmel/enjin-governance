/**
 * Telegram notices for moderators, so they don't have to watch the queue.
 * Goes to TELEGRAM_MODERATION_CHAT_ID, or TELEGRAM_CHAT_ID when that is
 * unset; "OFF" turns it off.
 *
 * New reports: one notice per item, since further reports on an item that
 * is already in the queue add nothing new, and a global ceiling keeps a
 * flood of reports from flooding the chat. The notice only says where to
 * look - never who reported, their note or the content itself.
 *
 * Failing content checks (scan-health.ts): at most one notice a day.
 */

import "server-only"
import { openReportCount } from "@/lib/db/moderation"
import { env } from "@/lib/env"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { postTelegramMessage, sendTelegramMessage, type TelegramFailure } from "@/lib/telegram/send"
import { REPORT_CATEGORY_LABELS, type ModerationTarget, type ReportCategory } from "./policy"
import { claimSlot } from "./slots"

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

/**
 * The moderators' chat: their own, the security chat as a fallback, or
 * none (switched off with OFF, or nothing set).
 */
export function moderationChat():
  | { kind: "own" | "security"; id: string }
  | { kind: "off" | "none"; id: null } {
  const own = env.TELEGRAM_MODERATION_CHAT_ID?.trim()
  const chat = own || env.TELEGRAM_CHAT_ID?.trim()
  if (!chat) return { kind: "none", id: null }
  if (chat.toUpperCase() === "OFF") return { kind: "off", id: null }
  return { kind: own ? "own" : "security", id: chat }
}

const queueLink = (appUrl: string) => `${appUrl.replace(/\/+$/, "")}/moderation`

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
    `Review: ${queueLink(appUrl)}`,
  ].join("\n")
}

/** Best-effort; never throws. */
export async function notifyNewReport(n: ReportNotice & { targetId: string }): Promise<void> {
  const chat = moderationChat()
  if (!chat.id || !env.TELEGRAM_BOT_TOKEN) return
  try {
    if ((await openReportCount(n.targetType, n.targetId)) > 1) return
    const rl = await enforceRateLimit({ ...RATE_LIMITS.moderationNotice, identity: "all" })
    if (!rl.allowed) return
  } catch {
    return
  }
  await sendTelegramMessage(chat.id, formatReportNotice(n, env.NEXT_PUBLIC_APP_URL))
}

const DAY_MS = 24 * 60 * 60_000

/** Pure: the text of the content-check alert. `problem` is one sentence. */
export function formatScanProblemNotice(problem: string, appUrl: string): string {
  return [
    "Automatic content checks are failing",
    problem,
    "Uploads are posted without a check until this is fixed.",
    `Status: ${queueLink(appUrl)} (Status tab)`,
  ].join("\n")
}

/** Tell moderators the checks are failing, at most once a day. Never throws. */
export async function notifyScanProblem(problem: string): Promise<void> {
  const chat = moderationChat()
  if (!chat.id || !env.TELEGRAM_BOT_TOKEN) return
  if (!(await claimSlot("notice:content_scan_health", DAY_MS, "automatic check"))) return
  await sendTelegramMessage(chat.id, formatScanProblemNotice(problem, env.NEXT_PUBLIC_APP_URL))
}

/** Send the admins' test message to the moderators' chat. Never throws. */
export async function sendModerationTestMessage(): Promise<
  { ok: true } | { ok: false; reason: TelegramFailure | "off" }
> {
  const chat = moderationChat()
  if (chat.kind === "off") return { ok: false, reason: "off" }
  return postTelegramMessage(
    chat.id ?? undefined,
    [
      "Test message from the moderation status page",
      "New reports and content-check alerts arrive in this chat.",
      `Queue: ${queueLink(env.NEXT_PUBLIC_APP_URL)}`,
    ].join("\n"),
  )
}

/**
 * POST /api/moderation/reports
 *
 * A signed-in user reports a proposal, an attachment or a comment. The
 * report goes to the moderators' queue; the reporter's identity is never
 * shown publicly. One open report per person per item.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { isDbConfigured } from "@/lib/db/client"
import { isMissingTable } from "@/lib/db/errors"
import { insertReport } from "@/lib/db/moderation"
import { notifyNewReport } from "@/lib/moderation/notify"
import { REPORT_CATEGORIES } from "@/lib/moderation/policy"
import { resolveTarget } from "@/lib/moderation/targets"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { objectExists } from "@/lib/r2/upload"

export const runtime = "nodejs"

const bodySchema = z
  .object({
    target_type: z.enum(["proposal", "attachment", "comment"]),
    target_id: z.string().min(1).max(300),
    category: z.enum(REPORT_CATEGORIES),
    note: z.string().max(500).nullable().optional(),
  })
  .strict()

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Database is not configured" }, { status: 503 })
  }
  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json({ ok: false, error: "Sign in to report content." }, { status: 401 })
  }
  const rl = await enforceRateLimit({ ...RATE_LIMITS.moderationReport, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many reports - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid report" }, { status: 400 })
  }

  const target = await resolveTarget(parsed.target_type, parsed.target_id)
  // A file must exist to be reported; made-up keys would only fill the queue.
  const missingFile =
    target?.type === "attachment" && !(await objectExists(target.id).catch(() => false))
  if (!target || missingFile) {
    return NextResponse.json({ ok: false, error: "That item doesn't exist." }, { status: 404 })
  }

  const severity =
    parsed.category === "secrets" || parsed.category === "illegal" ? "high" : "medium"
  let created: boolean
  try {
    created = await insertReport({
      targetType: target.type,
      targetId: target.id,
      proposalId: target.proposal?.id ?? null,
      source: "user",
      reporterUserId: me.id,
      category: parsed.category,
      severity,
      note: parsed.note?.trim() || null,
      details: null,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: isMissingTable(err)
          ? "Reporting isn't available yet."
          : "The report couldn't be saved - try again.",
      },
      { status: 503 },
    )
  }
  if (created) {
    await notifyNewReport({
      targetId: target.id,
      targetType: target.type,
      category: parsed.category,
      severity,
      source: "user",
      network: target.network,
      referendumIndex: target.proposal?.referendum_index ?? null,
    })
  }
  return NextResponse.json({ ok: true, duplicate: !created })
}

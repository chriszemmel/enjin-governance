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
import { insertReport } from "@/lib/db/moderation"
import { REPORT_CATEGORIES } from "@/lib/moderation/policy"
import { resolveTarget } from "@/lib/moderation/targets"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

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
  if (!target) {
    return NextResponse.json({ ok: false, error: "That item doesn't exist." }, { status: 404 })
  }

  const created = await insertReport({
    targetType: target.type,
    targetId: target.id,
    proposalId: target.proposal.id,
    source: "user",
    reporterUserId: me.id,
    category: parsed.category,
    severity: parsed.category === "secrets" || parsed.category === "illegal" ? "high" : "medium",
    note: parsed.note?.trim() || null,
    details: null,
  })
  return NextResponse.json({ ok: true, duplicate: !created })
}

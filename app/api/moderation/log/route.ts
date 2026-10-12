/**
 * GET /api/moderation/log - the public moderation log. Every action with
 * its reason and who took it; reporters are never listed.
 */

import { NextResponse, type NextRequest } from "next/server"
import { isDbConfigured } from "@/lib/db/client"
import { listActions, type ModerationActionRow } from "@/lib/db/moderation"

export const runtime = "nodejs"

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Database is not configured" }, { status: 503 })
  }
  const before = new URL(request.url).searchParams.get("before")
  const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined
  let rows: ModerationActionRow[]
  try {
    rows = await listActions(50, beforeDate)
  } catch {
    rows = [] // migration 011 not applied yet
  }
  return NextResponse.json({
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      target_type: r.target_type,
      network: r.network,
      referendum_index: r.referendum_index,
      action: r.action,
      reason: r.reason,
      source: r.source,
      actor: r.actor_label,
      created_at: r.created_at,
    })),
  })
}

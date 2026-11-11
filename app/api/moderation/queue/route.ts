/** GET /api/moderation/queue - open reports grouped per item (moderators). */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth/roles"
import { listQueue, queueStats } from "@/lib/db/moderation"

export const runtime = "nodejs"

export async function GET(): Promise<NextResponse> {
  const mod = await requireRole("moderator")
  if (mod instanceof NextResponse) return mod
  const [items, stats] = await Promise.all([listQueue(), queueStats()])
  return NextResponse.json(
    { ok: true, role: mod.role, items, stats },
    { headers: { "Cache-Control": "no-store" } },
  )
}

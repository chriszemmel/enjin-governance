/**
 * GET /api/moderation/status (admins)
 *
 * The deployment checklist for the Status tab: each item ok / warning /
 * problem with a one-line hint, and the content-check health. Booleans
 * and labels only - no secret, key, token or connection string ever
 * leaves the server.
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth/roles"
import { buildStatus } from "@/lib/moderation/status"
import { gatherStatusInputs } from "@/lib/moderation/status-probe"

export const runtime = "nodejs"

export async function GET(): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  const report = buildStatus(await gatherStatusInputs())
  return NextResponse.json(
    { ok: true, checked_at: new Date().toISOString(), ...report },
    { headers: { "Cache-Control": "no-store" } },
  )
}

/**
 * GET /api/moderation/state?proposal=<uuid>
 *
 * Public: which parts of a proposal are blurred, hidden or removed, with
 * the reason - so the proposal page can show a note instead of a broken
 * image. Visible items aren't listed.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { isDbConfigured } from "@/lib/db/client"
import { listStatesForProposal } from "@/lib/db/moderation"

export const runtime = "nodejs"

export async function GET(request: NextRequest): Promise<NextResponse> {
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("proposal"))
  if (!id.success) {
    return NextResponse.json({ ok: false, error: "Invalid proposal id" }, { status: 400 })
  }
  let rows: Awaited<ReturnType<typeof listStatesForProposal>> = []
  if (isDbConfigured()) {
    try {
      rows = await listStatesForProposal(id.data)
    } catch {
      rows = [] // migration 011 not applied yet
    }
  }
  return NextResponse.json(
    {
      ok: true,
      items: rows.map((r) => ({
        target_type: r.target_type,
        target_id: r.target_id,
        state: r.state,
        // Only a moderator's reason is public; an automatic hold's
        // explanation is written for moderators.
        reason: r.source === "automatic" ? null : r.reason,
        source: r.source,
        updated_at: r.updated_at,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

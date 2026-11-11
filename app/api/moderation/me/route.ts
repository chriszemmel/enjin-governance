/** GET /api/moderation/me - the signed-in user's moderation role, if any. */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/current-user"
import { roleFor } from "@/lib/auth/roles"

export const runtime = "nodejs"

export async function GET(): Promise<NextResponse> {
  const me = await getCurrentUser()
  const role = me ? await roleFor(me.address) : null
  return NextResponse.json({ ok: true, role }, { headers: { "Cache-Control": "no-store" } })
}

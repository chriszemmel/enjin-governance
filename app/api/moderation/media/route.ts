/**
 * GET /api/moderation/media?key=<bucket key>
 *
 * Moderators need to see a hidden image to decide on it, while /r refuses
 * to serve it to everyone else. Never cached.
 */

import { NextResponse, type NextRequest } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { requireRole } from "@/lib/auth/roles"
import { parseMediaKey } from "@/lib/moderation/policy"
import { getR2Client, isR2Configured, r2Bucket } from "@/lib/r2/client"
import { ownMediaKey } from "@/lib/r2/paths"

export const runtime = "nodejs"

export async function GET(request: NextRequest): Promise<NextResponse> {
  const mod = await requireRole("moderator")
  if (mod instanceof NextResponse) return mod
  if (!isR2Configured()) {
    return NextResponse.json({ ok: false, error: "Storage is not configured" }, { status: 503 })
  }
  const key = new URL(request.url).searchParams.get("key") ?? ""
  const parsed = parseMediaKey(key)
  if (!parsed || !ownMediaKey(key, parsed.network, parsed.proposalId)) {
    return NextResponse.json({ ok: false, error: "Not a proposal file" }, { status: 400 })
  }
  try {
    const res = await getR2Client().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: key }))
    if (!res.Body) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 })
    return new NextResponse(await res.Body.transformToByteArray(), {
      headers: {
        "Content-Type": res.ContentType ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 })
  }
}

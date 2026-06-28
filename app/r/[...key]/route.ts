/**
 * GET /r/[...key]
 *
 * Public read path for R2 objects, served from the app's own origin
 * instead of the bucket's `r2.dev` URL. The EGOV1 `u` pointer written on
 * chain points here (`https://<app>/r/proposals/...`), so the permanent
 * link lives on our durable domain and keeps resolving even if the R2
 * backend moves. It also adds CORS so browsers can fetch and sha256-verify
 * proposal JSON directly, and avoids the rate-limited public dev URL.
 *
 * Only keys under known public prefixes are served (see
 * `isPublicReadableKey`); anything else 404s, so this is not an open proxy
 * onto the bucket.
 */

import { type NextRequest, NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getR2Client, isR2Configured, r2Bucket } from "@/lib/r2/client"
import { isPublicReadableKey } from "@/lib/r2/paths"

export const runtime = "nodejs"

function notFound(): NextResponse {
  return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 })
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  if (!isR2Configured()) {
    return NextResponse.json(
      { ok: false, error: "Storage is not configured" },
      { status: 503 },
    )
  }

  const { key: segments } = await context.params
  const key = (segments ?? []).map((s) => decodeURIComponent(s)).join("/")
  if (!isPublicReadableKey(key)) return notFound()

  try {
    const res = await getR2Client().send(
      new GetObjectCommand({ Bucket: r2Bucket(), Key: key }),
    )
    if (!res.Body) return notFound()

    const bytes = await res.Body.transformToByteArray()
    const headers = new Headers()
    headers.set("Content-Type", res.ContentType ?? "application/octet-stream")
    // Mirror the cache window the object was written with (short for
    // editable proposal.json, immutable for media/avatars).
    headers.set(
      "Cache-Control",
      res.CacheControl ?? "public, max-age=30, must-revalidate",
    )
    // Public, read-only bytes: allow cross-origin fetch + sha256 verify.
    headers.set("Access-Control-Allow-Origin", "*")
    if (res.ETag) headers.set("ETag", res.ETag)

    return new NextResponse(bytes, { status: 200, headers })
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (name === "NoSuchKey" || name === "NotFound") return notFound()
    return NextResponse.json(
      { ok: false, error: "Upstream storage error" },
      { status: 502 },
    )
  }
}

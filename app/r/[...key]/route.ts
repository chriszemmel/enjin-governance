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
import { isDbConfigured } from "@/lib/db/client"
import { getState } from "@/lib/db/moderation"
import { mediaServable, parseMediaKey } from "@/lib/moderation/policy"
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
  let parts: string[]
  try {
    parts = (segments ?? []).map((s) => decodeURIComponent(s))
  } catch {
    return notFound() // malformed %-escape
  }
  // "." or empty segments would name the same object under a key that
  // skips the moderation lookup below.
  if (parts.some((p) => p === "" || p === "." || p.includes("/"))) return notFound()
  const key = parts.join("/")
  if (!isPublicReadableKey(key)) return notFound()

  // Proposal media (and its thumbnail) can be withheld by moderators. The
  // state lives in the DB; the proposal JSON itself is never withheld.
  // Both the key and, for thumbnails, the file it belongs to are checked.
  const isMedia = parseMediaKey(key) != null
  if (!isMedia && key.includes("/media/")) return notFound()
  if (isMedia && isDbConfigured()) {
    const candidates = key.endsWith(".thumb.webp") ? [key, key.slice(0, -".thumb.webp".length)] : [key]
    for (const candidate of candidates) {
      let state: Awaited<ReturnType<typeof getState>>
      try {
        state = await getState("attachment", candidate)
      } catch (err) {
        // Before migration 011 the table doesn't exist: nothing is moderated.
        // Any other failure must not serve something that may be hidden.
        if ((err as { code?: string } | null)?.code === "42P01") break
        return NextResponse.json(
          { ok: false, error: "Temporarily unavailable" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        )
      }
      if (!mediaServable(state)) {
        return NextResponse.json(
          { ok: false, error: "Withheld by moderators" },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        )
      }
    }
  }

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
      // Media is stored as immutable, but a moderator may hide it later, so
      // browsers and CDNs only keep it for a few minutes.
      isMedia
        ? "public, max-age=300"
        : (res.CacheControl ?? "public, max-age=30, must-revalidate"),
    )
    // Public, read-only bytes: allow cross-origin fetch + sha256 verify.
    headers.set("Access-Control-Allow-Origin", "*")
    // Serve exactly the stored type; never let the browser guess another.
    headers.set("X-Content-Type-Options", "nosniff")
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

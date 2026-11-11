import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth/current-user"
import { setAvatar } from "@/lib/db/users"
import {
  isPublicUrlMisconfigured,
  isR2Configured,
  PUBLIC_URL_NOT_CONFIGURED,
} from "@/lib/r2/client"
import { userAvatarKey } from "@/lib/r2/paths"
import { putObject } from "@/lib/r2/upload"
import { transcodeAvatar } from "@/lib/r2/avatar"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { postingSuspendedResponse } from "@/lib/moderation/suspension"
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/uploads/limits"

export const runtime = "nodejs"

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isR2Configured()) {
    return NextResponse.json(
      { ok: false, error: "Storage is not configured" },
      { status: 503 },
    )
  }
  // The avatar URL is built on the site's public URL; a localhost one in
  // production would be stored and never load.
  if (isPublicUrlMisconfigured()) {
    return NextResponse.json(
      { ok: false, error: PUBLIC_URL_NOT_CONFIGURED },
      { status: 503 },
    )
  }
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ ok: false }, { status: 401 })
  const suspended = await postingSuspendedResponse(me)
  if (suspended) return suspended

  const rl = await enforceRateLimit({ ...RATE_LIMITS.avatarUpload, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many uploads - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { ok: false, error: "Multipart body required" },
      { status: 400 },
    )
  }
  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Missing `file` part" },
      { status: 400 },
    )
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Images can be up to ${MAX_UPLOAD_LABEL}.` },
      { status: 413 },
    )
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported content-type: ${file.type}` },
      { status: 415 },
    )
  }

  const input = Buffer.from(await file.arrayBuffer())
  let png: Buffer
  try {
    png = await transcodeAvatar(input)
  } catch {
    return NextResponse.json(
      { ok: false, error: "This image could not be read. Try exporting it again as PNG or JPEG." },
      { status: 400 },
    )
  }

  const key = userAvatarKey(me.id)
  const put = await putObject({
    key,
    body: png,
    contentType: "image/png",
    cacheControl: "public, max-age=60, s-maxage=300",
  })
  // Cache-bust the URL with the upload timestamp so the browser doesn't
  // keep serving the old avatar after a re-upload.
  const url = `${put.url}?v=${Date.now()}`
  await setAvatar(me.id, url, key)

  return NextResponse.json({ ok: true, avatar_url: url })
}

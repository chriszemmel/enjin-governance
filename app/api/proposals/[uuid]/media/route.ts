/**
 * POST /api/proposals/[uuid]/media
 *
 * Multipart upload. Body: a single `file` field. Stores the file under
 * `proposals/{network}/{uuid}/media/{random}-{safe-filename}` and returns
 * the URL + sha256. Images are cleaned first (metadata dropped, scaled to
 * fit 2560 px) and get a WebP thumbnail next to them.
 *
 * Called BEFORE the proposal draft is finalised so the client can
 * include the URLs in proposal.json. The DB row for the proposal might
 * not exist yet - that's fine; we don't insert attachments here. The
 * draft endpoint inserts attachment rows after the proposals row exists.
 *
 * Hard limits:
 *   - 20 MB per file (matches the DB CHECK constraint)
 *   - image/png, image/jpeg, image/webp, image/gif, application/pdf
 *
 * DELETE /api/proposals/[uuid]/media?network=…&key=…
 *
 * Removes an uploaded file (and its thumbnail). For an unsigned draft it
 * simply goes away. For a published proposal the proposer may remove their
 * own file too: the JSON keeps listing it (so its EGOV1 record still
 * verifies) and the page and public log say it was removed.
 */

import { randomUUID } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { initializeWasm, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import { getProposalById, listAttachments } from "@/lib/db/proposals"
import { thumbKeyFor } from "@/lib/governance/proposal-media"
import { isR2Configured } from "@/lib/r2/client"
import {
  ImageProcessingError,
  processProposalImage,
  scanCopy,
} from "@/lib/r2/media-processing"
import { checkUpload, queueBlurredUpload } from "@/lib/moderation/auto-flag"
import { ownMediaKey, proposalMediaKey, uniqueMediaName } from "@/lib/r2/paths"
import { sniffMediaMime } from "@/lib/r2/sniff"
import { deleteObjects, putObject, sha256Hex } from "@/lib/r2/upload"
import { closeReports, insertAction, setState } from "@/lib/db/moderation"
import { postingSuspendedResponse } from "@/lib/moderation/suspension"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export const runtime = "nodejs"
// Room for the automatic check on large images and PDFs.
export const maxDuration = 60

const NETWORK_VALUES = [
  "enjin-relay",
  "enjin-matrix",
  "canary-relay",
  "canary-matrix",
] as const

const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
])

const uuidSchema = z.string().uuid()
const networkSchema = z.enum(NETWORK_VALUES)

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ uuid: string }> },
): Promise<NextResponse> {
  if (!isR2Configured()) {
    return NextResponse.json(
      { ok: false, error: "Storage is not configured" },
      { status: 503 },
    )
  }

  const { uuid: rawUuid } = await context.params
  const uuidParse = uuidSchema.safeParse(rawUuid)
  if (!uuidParse.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid proposal uuid" },
      { status: 400 },
    )
  }
  // Keys are always lower-case, whatever case the URL used.
  const proposalUuid = uuidParse.data.toLowerCase()

  const url = new URL(request.url)
  const networkParse = networkSchema.safeParse(url.searchParams.get("network"))
  if (!networkParse.success) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid `network` query param" },
      { status: 400 },
    )
  }
  const network = networkParse.data

  // The proposal row doesn't exist yet at upload time, so there's no
  // proposer to compare against - a signed-in session is all we can gate on.
  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to upload media." },
      { status: 401 },
    )
  }

  const suspended = await postingSuspendedResponse(me)
  if (suspended) return suspended

  const rl = await enforceRateLimit({ ...RATE_LIMITS.mediaUpload, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many uploads - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  // If a draft row already exists for this uuid, only its proposer may write
  // media into its R2 path. Pre-draft uploads have no row yet, so a signed-in
  // session is all we can gate on - the draft endpoint re-checks ownership by
  // public key before the row is created.
  if (isDbConfigured()) {
    const existing = await getProposalById(proposalUuid)
    if (existing) {
      await initializeWasm()
      if (!samePublicKey(existing.proposer_address, me.address)) {
        return NextResponse.json(
          { ok: false, error: "Only the proposer can upload media to this proposal." },
          { status: 403 },
        )
      }
    }
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
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File exceeds ${MAX_BYTES} bytes` },
      { status: 413 },
    )
  }
  const contentType = file.type || "application/octet-stream"
  if (!ALLOWED_MIME.has(contentType)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported content-type: ${contentType}` },
      { status: 415 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // Don't trust the client's content-type: derive the real type from the file
  // bytes and store THAT, so nothing can be persisted (and later served) under
  // a mismatched type. A file whose bytes aren't a recognized allowed type is
  // rejected even if it claimed one.
  const sniffed = sniffMediaMime(buffer)
  if (!sniffed) {
    return NextResponse.json(
      { ok: false, error: "File contents do not match a supported media type." },
      { status: 415 },
    )
  }

  // Images: drop metadata (GPS etc.), scale down, make a thumbnail. What's
  // stored - and hashed into the proposal - is the cleaned file.
  let body: Buffer = buffer
  let thumbnail: Buffer | null = null
  if (sniffed !== "application/pdf") {
    try {
      const processed = await processProposalImage(buffer, sniffed)
      body = processed.body
      thumbnail = processed.thumbnail
    } catch (e) {
      if (!(e instanceof ImageProcessingError)) throw e
      return NextResponse.json(
        { ok: false, error: "This image could not be read. Try exporting it again as PNG or JPEG." },
        { status: 415 },
      )
    }
  }

  // Automatic check (when enabled): clear violations - a readable recovery
  // phrase, say - are never stored; borderline images are stored blurred
  // and queued for a moderator.
  const check = await checkUpload(
    sniffed === "application/pdf"
      ? { kind: "pdf", bytes: body }
      : { kind: "image", jpeg: () => scanCopy(body) },
    file.name || "file",
  )
  if (check.action === "reject") {
    return NextResponse.json({ ok: false, error: check.message }, { status: 422 })
  }

  const storedName = uniqueMediaName(file.name || "file", randomUUID().slice(0, 8))
  const key = proposalMediaKey(network, proposalUuid, storedName)

  try {
    const result = await putObject({
      key,
      body,
      contentType: sniffed,
      cacheControl: "public, max-age=31536000, immutable",
    })
    if (thumbnail) {
      // Best-effort: galleries fall back to the full image without it.
      await putObject({
        key: thumbKeyFor(key),
        body: thumbnail,
        contentType: "image/webp",
        cacheControl: "public, max-age=31536000, immutable",
      }).catch(() => null)
    }
    if (check.action === "store_blurred") {
      const existing = isDbConfigured() ? await getProposalById(proposalUuid).catch(() => null) : null
      await queueBlurredUpload(result.key, existing?.id ?? null, check.outcome).catch(() => null)
    }
    return NextResponse.json({
      ok: true,
      moderation: check.action === "store_blurred" ? "blurred" : null,
      bucket_key: result.key,
      url: result.url,
      sha256: result.sha256,
      size_bytes: result.sizeBytes,
      content_type: sniffed,
      name: file.name || "file",
      precomputed_sha256_matches: result.sha256 === sha256Hex(body),
    })
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `R2 upload failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ uuid: string }> },
): Promise<NextResponse> {
  if (!isR2Configured()) {
    return NextResponse.json(
      { ok: false, error: "Storage is not configured" },
      { status: 503 },
    )
  }

  const { uuid: rawUuid } = await context.params
  const uuidParse = uuidSchema.safeParse(rawUuid)
  const url = new URL(request.url)
  const networkParse = networkSchema.safeParse(url.searchParams.get("network"))
  if (!uuidParse.success || !networkParse.success) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }
  // Keys are always lower-case, whatever case the URL used.
  const proposalUuid = uuidParse.data.toLowerCase()
  const key = ownMediaKey(url.searchParams.get("key") ?? "", networkParse.data, proposalUuid)
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "That file doesn't belong to this proposal." },
      { status: 400 },
    )
  }

  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to remove files." },
      { status: 401 },
    )
  }

  const rl = await enforceRateLimit({ ...RATE_LIMITS.mediaUpload, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  // Same ownership rule as uploads. Once a draft exists, only its proposer
  // may remove files, and only while nothing has been signed.
  if (isDbConfigured()) {
    const existing = await getProposalById(proposalUuid)
    if (existing) {
      await initializeWasm()
      if (!samePublicKey(existing.proposer_address, me.address)) {
        return NextResponse.json(
          { ok: false, error: "Only the proposer can remove files from this proposal." },
          { status: 403 },
        )
      }
      if (existing.status === "submitted") {
        return NextResponse.json(
          { ok: false, error: "Wait until the submission is confirmed, then remove the file." },
          { status: 409 },
        )
      }
      if (existing.status === "on_chain") {
        // A published proposal's JSON keeps listing the file (so its EGOV1
        // record still verifies); the file goes, and the page and the
        // public log say the proposer removed it.
        try {
          await deleteObjects([key, thumbKeyFor(key)])
        } catch {
          return NextResponse.json(
            { ok: false, error: "Storage error - the file was not removed." },
            { status: 502 },
          )
        }
        const reason = "The proposer removed their own file."
        await setState({
          targetType: "attachment",
          targetId: key,
          proposalId: proposalUuid,
          state: "removed",
          reason,
          source: "proposer",
        }).catch(() => null)
        await insertAction({
          targetType: "attachment",
          targetId: key,
          proposalId: proposalUuid,
          network: existing.network,
          referendumIndex: existing.referendum_index,
          action: "delete_file",
          reason,
          source: "proposer",
          actorPublicKey: null,
          actorLabel: "proposer",
        }).catch(() => null)
        return NextResponse.json({ ok: true, deleted: true })
      }
      if (existing.status !== "draft") {
        return NextResponse.json(
          { ok: false, error: "This proposal was cancelled; its files are cleaned up with it." },
          { status: 409 },
        )
      }
      // Still listed in the saved draft: keep it until the draft is saved
      // without it (re-staging cleans up files it no longer lists).
      const saved = await listAttachments(proposalUuid)
      if (saved.some((a) => a.bucket_key === key)) {
        return NextResponse.json({ ok: true, deleted: false })
      }
    }
  }

  try {
    await deleteObjects([key, thumbKeyFor(key)])
  } catch {
    return NextResponse.json(
      { ok: false, error: "Storage error - the file was not removed." },
      { status: 502 },
    )
  }
  // An automatic flag on a file that is gone has nothing left to decide.
  await closeReports("attachment", key, "resolved").catch(() => null)
  return NextResponse.json({ ok: true, deleted: true })
}

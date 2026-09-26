/**
 * Which files a proposal may show as images, and where to load them from.
 *
 * Attachment URLs inside proposal.json were written by the proposer's
 * browser, so they are never loaded as-is. Each one is reduced to its
 * bucket key, the key must sit in this proposal's own media folder, and
 * the image is then loaded through the app's own `/r` read route. An
 * external or foreign URL - one that could be swapped after voting starts,
 * or used to track readers - never becomes an <img>.
 *
 * Pure and client-safe; the server applies the same key check when it
 * stores attachments (see ownMediaKey).
 */

import { keyFromPublicUrl, ownMediaKey } from "@/lib/r2/paths"

/** Raster types the media route accepts and the gallery can show. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

/** Suffix of the small WebP preview stored next to each uploaded image. */
const THUMB_SUFFIX = ".thumb.webp"

export function thumbKeyFor(key: string): string {
  return `${key}${THUMB_SUFFIX}`
}

type AttachmentLike = {
  name: string
  url: string
  sha256: string
  content_type: string
  size_bytes: number
}

export type ProposalMedia = AttachmentLike & {
  /** Bucket key, checked to be inside this proposal's media folder. */
  key: string
  /** Same-origin URL to load the file from. */
  src: string
  /** Same-origin URL of the thumbnail (images only; may 404 on old uploads). */
  thumbSrc: string | null
  isImage: boolean
}

/**
 * Keep the attachments that really belong to this proposal and attach
 * same-origin URLs to them. Anything pointing elsewhere is dropped.
 */
export function resolveProposalMedia(
  attachments: readonly AttachmentLike[],
  network: string,
  proposalId: string,
): ProposalMedia[] {
  const out: ProposalMedia[] = []
  for (const a of attachments) {
    const key = ownMediaKey(keyFromPublicUrl(a.url), network, proposalId)
    if (!key) continue
    const isImage = IMAGE_TYPES.has(a.content_type)
    out.push({
      ...a,
      key,
      src: `/r/${key}`,
      thumbSrc: isImage ? `/r/${thumbKeyFor(key)}` : null,
      isImage,
    })
  }
  return out
}

/**
 * Resolve the target of `![alt](target)` against the proposal's own
 * images. The target may be the attachment's full URL (what "Insert into
 * text" writes) or just its file name. Returns null for anything else.
 */
export function findProposalImage(
  media: readonly ProposalMedia[],
  target: string,
): ProposalMedia | null {
  const t = target.trim()
  if (!t) return null
  const images = media.filter((m) => m.isImage)
  const byUrl = images.find((m) => m.url === t || m.src === t)
  if (byUrl) return byUrl
  const key = keyFromPublicUrl(t)
  const byKey = images.find((m) => m.key === key)
  if (byKey) return byKey
  return images.find((m) => m.name === t) ?? null
}

/** Markdown for one attachment: an image for pictures, a link for files. */
export function markdownForAttachment(a: { name: string; url: string; content_type: string }): string {
  const label = a.name.replace(/[[\]]/g, "")
  return IMAGE_TYPES.has(a.content_type) ? `![${label}](${a.url})` : `[${label}](${a.url})`
}

/**
 * Check the attachment details a browser sends with a proposal against
 * the stored files.
 *
 * Name, size, type and hash of each attachment are written into the
 * proposal's JSON, whose hash goes on chain, and the page decides how to
 * show a file by its type. The browser only relays what the upload route
 * answered, so every detail must match the stored object; anything else
 * is refused. Names are cleaned of characters that can disguise them.
 */

import "server-only"
import { keyFromPublicUrl } from "@/lib/r2/paths"
import { readObjectBytes, sha256Hex, statObject } from "@/lib/r2/upload"
import type { ProposalAttachmentMeta } from "./proposal-metadata"

type ClaimedAttachment = {
  key: string
  name: string
  sha256: string
  content_type: string
  size_bytes: number
}

type AttachmentCheck =
  | { ok: true; attachments: ClaimedAttachment[] }
  | { ok: false; status: 400 | 503; error: string }

// Control characters and direction overrides can disguise a name:
// "invoice‮fdp.exe" displays as "invoiceexe.pdf".
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g

export function cleanAttachmentName(name: string): string {
  const cleaned = name.normalize("NFC").replace(HIDDEN, "").replace(/\s+/g, " ").trim()
  return cleaned.slice(0, 255) || "file"
}

/**
 * @param previous the attachments of the version being replaced. A file
 *   removed after it was saved (by its proposer or a moderator) stays
 *   listed with its old details, and files stored before uploads recorded
 *   their hash keep the hash that version saved.
 */
export async function checkAttachments(
  claims: ClaimedAttachment[],
  previous: ReadonlyArray<ProposalAttachmentMeta>,
): Promise<AttachmentCheck> {
  const before = new Map(previous.map((a) => [keyFromPublicUrl(a.url), a]))
  let results: (string | null)[]
  try {
    results = await Promise.all(claims.map((c) => problemWith(c, before.get(c.key))))
  } catch {
    return { ok: false, status: 503, error: "Could not check the attachments - try again." }
  }
  const problem = results.find((r) => r != null)
  if (problem) return { ok: false, status: 400, error: problem }
  return {
    ok: true,
    attachments: claims.map((c) => ({ ...c, name: cleanAttachmentName(c.name) })),
  }
}

/** What is wrong with one claimed attachment, or null. Throws if storage can't be read. */
async function problemWith(
  claim: ClaimedAttachment,
  saved: ProposalAttachmentMeta | undefined,
): Promise<string | null> {
  const label = `"${cleanAttachmentName(claim.name)}"`
  const unchanged =
    saved != null &&
    saved.sha256 === claim.sha256 &&
    saved.size_bytes === claim.size_bytes &&
    saved.content_type === claim.content_type
  const stored = await statObject(claim.key)
  if (!stored) {
    return unchanged
      ? null
      : `${label} is no longer stored. Remove it from the proposal and save again.`
  }
  let sha256 = stored.sha256
  if (!sha256) {
    if (unchanged) {
      sha256 = saved.sha256
    } else {
      const bytes = await readObjectBytes(claim.key)
      sha256 = bytes ? sha256Hex(bytes) : null
    }
  }
  if (
    stored.sizeBytes !== claim.size_bytes ||
    stored.contentType !== claim.content_type ||
    sha256 !== claim.sha256
  ) {
    return `The details of ${label} don't match the uploaded file. Remove it and upload it again.`
  }
  return null
}

/** The attachments a stored proposal JSON lists (empty when it has none or can't be parsed). */
export function listedAttachments(json: string | null): ProposalAttachmentMeta[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as { attachments?: unknown }
    return Array.isArray(parsed.attachments)
      ? parsed.attachments.filter(
          (a): a is ProposalAttachmentMeta =>
            a != null && typeof a === "object" && typeof (a as { url?: unknown }).url === "string",
        )
      : []
  } catch {
    return []
  }
}

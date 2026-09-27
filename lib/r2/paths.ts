/**
 * Bucket-key conventions for the `enjin-governance` R2 bucket.
 *
 * Layout:
 *   proposals/{network}/{uuid}/proposal-{sha256 prefix}.json   (one per staged version)
 *   proposals/{network}/{uuid}/proposal.json                   (drafts staged before v1.1)
 *   proposals/{network}/{uuid}/media/{safe-filename}
 *   proposals/{network}/index/{referendum_index}.json
 *   user-avatars/{user_uuid}.png
 *
 * Anything that wants to find a proposal externally only needs to read
 * the EGOV1 envelope bound via `referenda.metadataOf` (or, for older
 * referenda, the `system.remark` payload from the submission batch);
 * the URL points straight at proposal.json.
 */

import type { ChainId } from "@/lib/chain/chains"

/** Replace anything that isn't a-z, 0-9, _, -, or . with underscore. */
export function sanitiseFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120)
}

export function proposalJsonKey(network: ChainId, proposalUuid: string): string {
  return `proposals/${network}/${proposalUuid}/proposal.json`
}

/**
 * Key for one staged version of a proposal's JSON, named after its hash.
 * Every version gets its own object, so a version that an on-chain
 * envelope may already point at (a batch still in flight, a second tab)
 * is never overwritten by a later re-stage.
 */
export function proposalJsonVersionKey(
  network: ChainId,
  proposalUuid: string,
  sha256: string,
): string {
  return `proposals/${network}/${proposalUuid}/proposal-${sha256.slice(0, 16)}.json`
}

/** Whether a key is one of a proposal's JSON versions (not media). */
export function isProposalJsonKey(key: string): boolean {
  return /\/proposal(-[0-9a-f]{16})?\.json$/.test(key)
}

export function proposalMediaKey(
  network: ChainId,
  proposalUuid: string,
  filename: string,
): string {
  return `proposals/${network}/${proposalUuid}/media/${sanitiseFilename(filename)}`
}

/**
 * Name an upload is stored under: a short random prefix plus the sanitised
 * original name, so two uploads called "image.png" never overwrite each
 * other (media is cached as immutable, so an overwrite would also keep
 * serving the old bytes). Capped so the thumbnail key still fits.
 */
export function uniqueMediaName(original: string, random: string): string {
  // Never end in the thumbnail suffix: "x.thumb.webp" would read as the
  // thumbnail of "x", and a check on one could miss the other.
  const base = (sanitiseFilename(original).slice(0, 90) || "file").replace(/\.thumb\.webp$/i, "-thumb.webp")
  return `${random}-${base}`
}

/** Folder every object of one proposal lives under (JSON + media). */
export function proposalPrefix(network: string, proposalUuid: string): string {
  return `proposals/${network}/${proposalUuid}/`
}

/**
 * Canonicalise a client-supplied attachment key and confirm it sits in this
 * proposal's own media folder. Returns the key to store, or null when it
 * points anywhere else.
 *
 * Attachment keys arrive from the browser, and the delete route removes every
 * stored key from the bucket - so an unchecked key would let a draft claim
 * (and later delete) objects that belong to other proposals or users.
 *
 * The edit page derives keys from public URLs, which for app-origin URLs
 * still carry the `/r` read-route segment (`r/proposals/...`), so one
 * leading `r/` is stripped before the check. The file name must use the same
 * charset sanitiseFilename produces.
 */
export function ownMediaKey(
  raw: string,
  network: string,
  proposalUuid: string,
): string | null {
  const key = raw.startsWith("r/") ? raw.slice(2) : raw
  const mediaPrefix = `${proposalPrefix(network, proposalUuid)}media/`
  if (!key.startsWith(mediaPrefix)) return null
  // The media route only ever stores sanitised names (see sanitiseFilename),
  // so anything outside that charset - slashes, %, spaces, "." / ".." - is
  // not a real upload. "a..b.pdf" stays valid.
  const name = key.slice(mediaPrefix.length)
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(name) || name === "." || name === "..") return null
  return key
}

/**
 * Bucket key behind a public object URL, for both `<app>/r/<key>` and
 * `<bucket-host>/<key>` forms. Proposal JSON only carries attachment URLs,
 * so resuming a draft re-derives the keys from them.
 */
export function keyFromPublicUrl(url: string): string {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return url
  }
  path = path.replace(/^\/+/, "")
  return path.startsWith("r/") ? path.slice(2) : path
}

export function proposalIndexRedirectKey(
  network: ChainId,
  referendumIndex: number,
): string {
  return `proposals/${network}/index/${referendumIndex}.json`
}

export function userAvatarKey(userUuid: string): string {
  return `user-avatars/${userUuid}.png`
}

/** Build a public URL for a bucket key by joining with a public base. */
export function publicUrlFor(publicBase: string, key: string): string {
  const trimmed = publicBase.endsWith("/") ? publicBase.slice(0, -1) : publicBase
  return `${trimmed}/${key}`
}

/**
 * Keys the public `/r` read route is allowed to serve. The route streams
 * objects straight from the bucket, so this allowlist is what stops it
 * being an open proxy onto everything in R2: only the genuinely public
 * object families (proposal JSON / media, user avatars) are readable, and
 * any path-traversal attempt is rejected. Admin backups (`backups/`, see
 * lib/backup/keys.ts) hold personal data and must never be added here.
 */
const PUBLIC_READ_PREFIXES = ["proposals/", "user-avatars/"]

export function isPublicReadableKey(key: string): boolean {
  if (!key) return false
  if (key.includes("..") || key.includes("\\") || key.startsWith("/")) return false
  return PUBLIC_READ_PREFIXES.some((prefix) => key.startsWith(prefix))
}

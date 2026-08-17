/**
 * Bucket-key conventions for the `enjin-governance` R2 bucket.
 *
 * Layout:
 *   proposals/{network}/{uuid}/proposal.json
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

export function proposalMediaKey(
  network: ChainId,
  proposalUuid: string,
  filename: string,
): string {
  return `proposals/${network}/${proposalUuid}/media/${sanitiseFilename(filename)}`
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
 * any path-traversal attempt is rejected.
 */
const PUBLIC_READ_PREFIXES = ["proposals/", "user-avatars/"]

export function isPublicReadableKey(key: string): boolean {
  if (!key) return false
  if (key.includes("..") || key.includes("\\") || key.startsWith("/")) return false
  return PUBLIC_READ_PREFIXES.some((prefix) => key.startsWith(prefix))
}

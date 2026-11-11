/**
 * A draft keeps every staged version of its JSON under its own key (see
 * proposalJsonVersionKey). A batch may have been signed from any of them -
 * an older version in a second tab, say - so the checks that ask "is this
 * draft on chain?" and "which version is?" look at all of them.
 */

import "server-only"
import { createHash } from "node:crypto"
import { publicAssetBase, r2PublicBase } from "@/lib/r2/client"
import { isProposalJsonKey, keyFromPublicUrl, proposalPrefix, publicUrlFor } from "@/lib/r2/paths"
import { listObjectKeys, readObjectText } from "@/lib/r2/upload"
import { isEnvelopeOnChain } from "./envelope-status"
import { expectedMetadataHash } from "./proposal-metadata"

type DraftRow = {
  id: string
  network: string
  json_url: string
  json_key: string
  json_sha256: string
}

type StoredVersion = { key: string; url: string; sha256: string; text: string }

/** Every stored JSON version of a draft; throws if the folder can't be listed. */
export async function listVersionKeys(row: DraftRow): Promise<string[]> {
  const keys = (await listObjectKeys(proposalPrefix(row.network, row.id))).filter(isProposalJsonKey)
  return keys.includes(row.json_key) ? keys : [row.json_key, ...keys]
}

/**
 * The URLs an older version may have been staged under. Its row only keeps
 * the current version's URL, and the app's public base changes when
 * NEXT_PUBLIC_APP_URL is set or moved, so both bases are tried.
 */
function candidateUrls(key: string): string[] {
  const urls = [publicUrlFor(publicAssetBase(), key)]
  try {
    const bucketUrl = publicUrlFor(r2PublicBase(), key)
    if (!urls.includes(bucketUrl)) urls.push(bucketUrl)
  } catch {
    // No bucket URL configured: the app base is the only one.
  }
  return urls
}

/** Every older version, read in parallel; throws if one can't be read. */
async function olderVersions(
  row: DraftRow,
  keys: string[],
): Promise<(Omit<StoredVersion, "url"> & { urls: string[] })[]> {
  const read = await Promise.all(
    keys
      .filter((key) => key !== row.json_key)
      .map(async (key) => {
        const text = await readObjectText(key)
        if (text == null) return null
        const sha256 = createHash("sha256").update(text, "utf8").digest("hex")
        return { key, sha256, text, urls: candidateUrls(key) }
      }),
  )
  return read.filter((v) => v != null)
}

/** Whether any version's envelope is noted on chain. Throws if the chain can't be read. */
export async function anyVersionOnChain(row: DraftRow, keys: string[]): Promise<boolean> {
  const envelopes: { url: string; sha256: string }[] = []
  if (row.json_url && row.json_sha256) {
    envelopes.push({ url: row.json_url, sha256: row.json_sha256 })
  }
  for (const v of await olderVersions(row, keys)) {
    for (const url of v.urls) envelopes.push({ url, sha256: v.sha256 })
  }
  const noted = await Promise.all(
    envelopes.map((e) => isEnvelopeOnChain(row.network, e.url, e.sha256)),
  )
  return noted.includes(true)
}

/** The older version whose envelope hash a referendum's metadata carries, if any. */
export async function versionWithMetadataHash(
  row: DraftRow,
  keys: string[],
  metadataHash: string,
): Promise<StoredVersion | null> {
  for (const v of await olderVersions(row, keys)) {
    const url = v.urls.find(
      (u) => expectedMetadataHash(u, v.sha256).toLowerCase() === metadataHash.toLowerCase(),
    )
    if (url) return { key: v.key, url, sha256: v.sha256, text: v.text }
  }
  return null
}

/**
 * Whether any stored version (the current one included) lists this file.
 * A draft can be switched back to an older version when that one was
 * signed, so its files stay until the whole draft is deleted.
 */
export async function anyVersionListsFile(keys: string[], fileKey: string): Promise<boolean> {
  const texts = await Promise.all(keys.map((key) => readObjectText(key)))
  return texts.some((text) => text != null && listsFile(text, fileKey))
}

function listsFile(text: string, fileKey: string): boolean {
  try {
    const j = JSON.parse(text) as { attachments?: { url?: unknown }[] }
    return (j.attachments ?? []).some(
      (a) => typeof a?.url === "string" && keyFromPublicUrl(a.url) === fileKey,
    )
  } catch {
    return false
  }
}

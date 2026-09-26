/**
 * A draft keeps every staged version of its JSON under its own key (see
 * proposalJsonVersionKey). A batch may have been signed from any of them -
 * an older version in a second tab, say - so the checks that ask "is this
 * draft on chain?" and "which version is?" look at all of them.
 */

import "server-only"
import { createHash } from "node:crypto"
import { publicAssetBase } from "@/lib/r2/client"
import { isProposalJsonKey, proposalPrefix, publicUrlFor } from "@/lib/r2/paths"
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

async function* olderVersions(row: DraftRow, keys: string[]): AsyncGenerator<StoredVersion> {
  for (const key of keys) {
    if (key === row.json_key) continue
    const text = await readObjectText(key)
    if (text == null) continue
    const sha256 = createHash("sha256").update(text, "utf8").digest("hex")
    yield { key, url: publicUrlFor(publicAssetBase(), key), sha256, text }
  }
}

/** Whether any version's envelope is noted on chain. Throws if the chain can't be read. */
export async function anyVersionOnChain(row: DraftRow, keys: string[]): Promise<boolean> {
  if (row.json_url && row.json_sha256) {
    if (await isEnvelopeOnChain(row.network, row.json_url, row.json_sha256)) return true
  }
  for await (const v of olderVersions(row, keys)) {
    if (await isEnvelopeOnChain(row.network, v.url, v.sha256)) return true
  }
  return false
}

/** The older version whose envelope hash a referendum's metadata carries, if any. */
export async function versionWithMetadataHash(
  row: DraftRow,
  keys: string[],
  metadataHash: string,
): Promise<StoredVersion | null> {
  for await (const v of olderVersions(row, keys)) {
    if (expectedMetadataHash(v.url, v.sha256).toLowerCase() === metadataHash.toLowerCase()) {
      return v
    }
  }
  return null
}

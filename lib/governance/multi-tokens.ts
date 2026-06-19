/**
 * Helpers around Enjin's `multiTokens` pallet (NFT / multi-token support).
 *
 * Two things this module does:
 *
 *  1. Read a single attribute on `(collectionId, tokenId?)`. Attributes
 *     are stored as bytes - we accept a string key, encode it to UTF-8,
 *     and decode the returned value back to UTF-8.
 *
 *  2. Fetch and normalise the off-chain JSON pointed to by a
 *     collection-level `uri` attribute. Enjin's convention is a
 *     template URL containing the literal `{id}` token, which is
 *     replaced with `<collectionId>-<tokenId>` to address an individual
 *     token's metadata file.
 *
 * Everything is defensive: a missing pallet, a missing attribute, a
 * malformed URL, a CORS-blocked fetch, or invalid JSON all resolve to
 * `null` so the UI can fall back to plain-text labels.
 */

import type { ApiPromise } from "@polkadot/api"

/** Standard collection-level attribute key holding the metadata URI template. */
const URI_ATTRIBUTE_KEY = "uri"

/**
 * Read attribute `key` on `(collectionId, tokenId?)`. Pass `tokenId=null`
 * for collection-level attributes (e.g. the `uri` template).
 *
 * Returns the attribute's value decoded as UTF-8, or null when the
 * attribute is absent or the pallet isn't exposed by this runtime.
 */
async function getMultiTokenAttribute(
  api: ApiPromise,
  collectionId: bigint,
  tokenId: bigint | null,
  key: string,
): Promise<string | null> {
  const q = api.query.multiTokens?.attributes
  if (!q) return null

  const keyBytes = bytesToHex(new TextEncoder().encode(key))
  const raw = await q(
    collectionId.toString(),
    tokenId == null ? null : tokenId.toString(),
    keyBytes,
  )

  const parsed = (raw as { toJSON?: () => unknown } | null | undefined)?.toJSON?.()
  if (parsed == null || typeof parsed !== "object") return null

  const valueRaw = (parsed as { value?: unknown }).value
  return decodeBytesValue(valueRaw)
}

/**
 * Read the collection's `uri` template - the URL pattern containing
 * `{id}` that resolves to individual token metadata JSON.
 */
export function getCollectionUriTemplate(
  api: ApiPromise,
  collectionId: bigint,
): Promise<string | null> {
  return getMultiTokenAttribute(api, collectionId, null, URI_ATTRIBUTE_KEY)
}

/**
 * Substitute `{id}` placeholders in `template` with `<collectionId>-<tokenId>`.
 * Standard Enjin convention - every token under a collection shares the
 * same template, addressed by its combined collection-token id.
 */
export function buildTokenMetadataUrl(
  template: string,
  collectionId: bigint,
  tokenId: bigint,
): string {
  const id = `${collectionId}-${tokenId}`
  return template.replaceAll("{id}", id)
}

export type TokenMetadata = {
  name: string | null
  description: string | null
  /** Best-effort cover image - fallback_image, first media url, or `image`. */
  image: string | null
  externalUrl: string | null
}

/**
 * Fetch + normalise a token metadata JSON. Returns null on network error,
 * non-200 response, malformed JSON, or absent image fields.
 */
export async function fetchTokenMetadata(url: string): Promise<TokenMetadata | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    })
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, unknown>
    return normaliseTokenMetadata(json)
  } catch {
    return null
  }
}

export function normaliseTokenMetadata(json: Record<string, unknown>): TokenMetadata {
  const fallback = typeof json.fallback_image === "string" ? json.fallback_image : null
  const media = Array.isArray(json.media) ? (json.media as Array<Record<string, unknown>>) : []
  const firstMedia = media[0]
  const mediaUrl =
    firstMedia && typeof firstMedia.url === "string" ? (firstMedia.url as string) : null
  const direct = typeof json.image === "string" ? json.image : null

  return {
    name: typeof json.name === "string" ? json.name : null,
    description: typeof json.description === "string" ? json.description : null,
    image: fallback ?? mediaUrl ?? direct,
    externalUrl: typeof json.external_url === "string" ? json.external_url : null,
  }
}

/**
 * Decode the `value` field returned by `multiTokens.attributes`. The
 * runtime returns bytes; polkadot.js's `toJSON` renders those as a
 * `0x…` hex string most of the time but can also yield a UTF-8 string
 * directly. Accept both.
 */
function decodeBytesValue(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw === "string") {
    if (!raw.startsWith("0x")) return raw || null
    const hex = raw.slice(2)
    const parts = hex.match(/.{1,2}/g) ?? []
    const bytes = new Uint8Array(parts.map((b) => parseInt(b, 16)))
    if (bytes.length === 0) return null
    try {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim()
      return text.length > 0 ? text : null
    } catch {
      return null
    }
  }
  if (Array.isArray(raw)) {
    try {
      const bytes = new Uint8Array(raw as number[])
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim()
      return text.length > 0 ? text : null
    } catch {
      return null
    }
  }
  return null
}

function bytesToHex(bytes: Uint8Array): string {
  let h = "0x"
  for (const b of bytes) h += b.toString(16).padStart(2, "0")
  return h
}

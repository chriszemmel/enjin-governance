/**
 * In-memory stand-in for @/lib/r2/upload. Records every putJson/putObject and
 * lets deleteObjects mutate the same in-memory "bucket" so tests can assert
 * exactly which keys were written or removed.
 */
import { createHash } from "node:crypto"

/**
 * `sha256` is the hash recorded at upload (object metadata): computed from
 * the body when absent, and null for a file stored before hashes were
 * recorded.
 */
export type BucketEntry = { body: string; contentType: string; sha256?: string | null }

export const bucket = new Map<string, BucketEntry>()
export const deleteCalls: string[][] = []
/** Make HEAD requests fail, as when storage can't be reached. */
export const faults = { stat: false }

export function resetBucket(): void {
  bucket.clear()
  deleteCalls.length = 0
  faults.stat = false
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex")
}

// stable-ish stringify matching lib/r2/json stringifyStable (sorted keys)
function stringifyStable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce((acc: Record<string, unknown>, k) => {
          acc[k] = (v as Record<string, unknown>)[k]
          return acc
        }, {})
    }
    return v
  })
}

export type PutObjectResult = {
  key: string
  url: string
  sha256: string
  sizeBytes: number
}

export async function putJson(key: string, value: unknown): Promise<PutObjectResult> {
  const json = stringifyStable(value)
  bucket.set(key, { body: json, contentType: "application/json" })
  return {
    key,
    url: `https://fake.local/r/${key}`,
    sha256: sha256Hex(json),
    sizeBytes: Buffer.byteLength(json, "utf8"),
  }
}

export async function putObject(args: {
  key: string
  body: Uint8Array | Buffer
  contentType: string
}): Promise<PutObjectResult> {
  const body = Buffer.from(args.body)
  bucket.set(args.key, { body: body.toString("utf8"), contentType: args.contentType })
  return {
    key: args.key,
    url: `https://fake.local/r/${args.key}`,
    sha256: createHash("sha256").update(body).digest("hex"),
    sizeBytes: body.byteLength,
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))]
  deleteCalls.push(unique)
  for (const k of unique) bucket.delete(k)
}

export async function readObjectText(key: string): Promise<string | null> {
  return bucket.get(key)?.body ?? null
}

export async function listObjectKeys(prefix: string): Promise<string[]> {
  return [...bucket.keys()].filter((k) => k.startsWith(prefix))
}

export async function objectExists(key: string): Promise<boolean> {
  return bucket.has(key)
}

export async function statObject(
  key: string,
): Promise<{ sizeBytes: number; contentType: string | null; sha256: string | null } | null> {
  if (faults.stat) throw new Error("storage unreachable")
  const entry = bucket.get(key)
  if (!entry) return null
  return {
    sizeBytes: Buffer.byteLength(entry.body, "utf8"),
    contentType: entry.contentType,
    sha256: entry.sha256 === undefined ? sha256Hex(entry.body) : entry.sha256,
  }
}

export async function readObjectBytes(key: string): Promise<Buffer | null> {
  const entry = bucket.get(key)
  return entry ? Buffer.from(entry.body, "utf8") : null
}

export { sha256Hex }

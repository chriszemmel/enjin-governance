/**
 * In-memory stand-in for @/lib/r2/upload. Records every putJson/putObject and
 * lets deleteObjects mutate the same in-memory "bucket" so tests can assert
 * exactly which keys were written or removed.
 */
import { createHash } from "node:crypto"

export type BucketEntry = { body: string; contentType: string }

export const bucket = new Map<string, BucketEntry>()
export const deleteCalls: string[][] = []

export function resetBucket(): void {
  bucket.clear()
  deleteCalls.length = 0
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

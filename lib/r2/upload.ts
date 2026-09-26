/**
 * Server-side R2 upload helpers. All routes that accept user content
 * (proposal media, avatar) go through here so we get a consistent
 * sha256 + cache-control story.
 */

import "server-only"
import { createHash } from "node:crypto"
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import { getR2Client, r2Bucket, publicAssetBase } from "./client"
import { stringifyStable } from "./json"
import { publicUrlFor } from "./paths"

export type PutObjectArgs = {
  key: string
  body: Uint8Array | Buffer
  contentType: string
  /**
   * Cache header. Defaults to a long immutable cache because every key
   * in the bucket is either immutable (proposal.json, media) or
   * cache-busted at the URL level (avatar via ?v=updated_at).
   */
  cacheControl?: string
}

export type PutObjectResult = {
  key: string
  url: string
  sha256: string
  sizeBytes: number
}

export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export async function putObject(args: PutObjectArgs): Promise<PutObjectResult> {
  const client = getR2Client()
  const body = args.body
  const sha256 = sha256Hex(body)
  await client.send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: args.key,
      Body: body,
      ContentType: args.contentType,
      CacheControl: args.cacheControl ?? "public, max-age=31536000, immutable",
      ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
      // Kept with the object so a later save can check the hash a
      // proposal claims for it without downloading it (statObject).
      Metadata: { sha256 },
    }),
  )
  return {
    key: args.key,
    url: publicUrlFor(publicAssetBase(), args.key),
    sha256,
    sizeBytes: body.byteLength,
  }
}

/**
 * Best-effort batch delete. Used when a draft proposal is hard-deleted so its
 * R2 objects (proposal.json + attachments) don't linger. Only deletable rows
 * (drafts / cancelled / failed) reach this - never an on-chain proposal whose
 * URL a finalised remark pins - so removing the objects is safe. De-dupes,
 * ignores empties, and sends at most 1000 keys per request (the S3 limit).
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))]
  const client = getR2Client()
  // DeleteObjects takes at most 1000 keys per request.
  for (let i = 0; i < unique.length; i += 1000) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: r2Bucket(),
        Delete: { Objects: unique.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      }),
    )
  }
}

/** Every key under a prefix (a proposal's folder holds a handful). */
export async function listObjectKeys(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const res = await getR2Client().send(
      new ListObjectsV2Command({ Bucket: r2Bucket(), Prefix: prefix, ContinuationToken: token }),
    )
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key)
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token && keys.length < 5_000)
  return keys
}

/**
 * Drop-in for putObject with a JSON value. Stringifies with sorted keys
 * so the sha256 is stable across serialisers - important because we put
 * this hash inside the on-chain EGOV1 envelope.
 */
export async function putJson(
  key: string,
  value: unknown,
): Promise<PutObjectResult> {
  const json = stringifyStable(value)
  return putObject({
    key,
    body: Buffer.from(json, "utf8"),
    contentType: "application/json",
    // The same proposal.json key gets overwritten on every edit, so
    // the cache window has to be short. 30s is enough to absorb
    // bursts (e.g. an indexer scanning sequential referenda) without
    // making readers wait an hour to pick up a proposer edit.
    cacheControl: "public, max-age=30, must-revalidate",
  })
}

/** Read a stored object as text, or null when it doesn't exist. */
export async function readObjectText(key: string): Promise<string | null> {
  try {
    const res = await getR2Client().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: key }))
    return res.Body ? await res.Body.transformToString("utf-8") : null
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (name === "NoSuchKey" || name === "NotFound") return null
    throw err
  }
}

export type StoredObjectInfo = {
  sizeBytes: number
  contentType: string | null
  /** Recorded at upload; null for files stored before that was done. */
  sha256: string | null
}

/** Size, type and recorded hash of an object (HEAD), or null if it doesn't exist. */
export async function statObject(key: string): Promise<StoredObjectInfo | null> {
  try {
    const res = await getR2Client().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }))
    const sha256 = res.Metadata?.sha256
    return {
      sizeBytes: res.ContentLength ?? 0,
      contentType: res.ContentType ?? null,
      sha256: sha256 && /^[0-9a-f]{64}$/.test(sha256) ? sha256 : null,
    }
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (name === "NotFound" || name === "NoSuchKey") return null
    throw err
  }
}

/** Read a stored object's bytes, or null when it doesn't exist. */
export async function readObjectBytes(key: string): Promise<Buffer | null> {
  try {
    const res = await getR2Client().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: key }))
    return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (name === "NoSuchKey" || name === "NotFound") return null
    throw err
  }
}

/** Whether an object exists (HEAD request). */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }))
    return true
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (name === "NotFound" || name === "NoSuchKey") return false
    throw err
  }
}

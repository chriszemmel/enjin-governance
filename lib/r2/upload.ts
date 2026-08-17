/**
 * Server-side R2 upload helpers. All routes that accept user content
 * (proposal media, avatar) go through here so we get a consistent
 * sha256 + cache-control story.
 */

import "server-only"
import { createHash } from "node:crypto"
import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3"
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
 * ignores empties, and tolerates up to 1000 keys per call (the S3 limit).
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))]
  if (unique.length === 0) return
  const client = getR2Client()
  await client.send(
    new DeleteObjectsCommand({
      Bucket: r2Bucket(),
      Delete: { Objects: unique.map((Key) => ({ Key })), Quiet: true },
    }),
  )
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

/**
 * The bucket side of a backup: reading the objects that go into it, and
 * keeping the finished archives under `backups/` (see keys.ts).
 *
 * An archive is written with a multipart upload, a part at a time, so it
 * never has to fit in memory or in a response: the browser downloads it
 * straight from R2 through a signed link that expires in a few minutes.
 */

import "server-only"
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getR2Client, r2Bucket } from "@/lib/r2/client"
import { BACKUP_PREFIX, backupCreatedAt, isBackupKey } from "./keys"
import type { ByteSink } from "./zip"

/**
 * Size of every part but the last. R2 wants at least 5 MiB, and the same
 * size for all parts but the last.
 */
const PART_SIZE = 8 * 1024 * 1024

/** How long a download link works. */
const DOWNLOAD_LINK_SECONDS = 300

export type BucketObject = { key: string; size: number; modified: Date | null }

export type StoredBackup = { key: string; size: number; created: string }

const isNotFound = (err: unknown) => {
  const name = (err as { name?: string } | null)?.name
  return name === "NoSuchKey" || name === "NotFound"
}

/** Every object under a prefix, with its size. */
export async function listObjects(prefix: string): Promise<BucketObject[]> {
  const out: BucketObject[] = []
  let token: string | undefined
  do {
    const res = await getR2Client().send(
      new ListObjectsV2Command({ Bucket: r2Bucket(), Prefix: prefix, ContinuationToken: token }),
    )
    for (const o of res.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified ?? null })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return out
}

/** An object's bytes as they arrive, or null when it no longer exists. */
export async function readObject(key: string): Promise<AsyncIterable<Uint8Array> | null> {
  let body: unknown
  try {
    body = (await getR2Client().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: key }))).Body
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  if (!body) return null
  // In Node the body is a Readable, which is async iterable.
  if (typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function") {
    return body as AsyncIterable<Uint8Array>
  }
  const stream = (body as { transformToWebStream?: () => ReadableStream<Uint8Array> })
    .transformToWebStream
  if (typeof stream !== "function") throw new Error("Unreadable object body")
  const reader = stream.call(body).getReader()
  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    },
  }
}

/** A backup archive being written to the bucket, part by part. */
export class BackupUpload implements ByteSink {
  readonly key: string
  readonly #uploadId: string
  #parts: { PartNumber: number; ETag: string }[] = []
  #buffer: Uint8Array[] = []
  #buffered = 0
  /** Bytes written so far. */
  size = 0

  private constructor(key: string, uploadId: string) {
    this.key = key
    this.#uploadId = uploadId
  }

  static async open(key: string, fileName: string): Promise<BackupUpload> {
    const res = await getR2Client().send(
      new CreateMultipartUploadCommand({
        Bucket: r2Bucket(),
        Key: key,
        ContentType: "application/zip",
        ContentDisposition: `attachment; filename="${fileName}"`,
        CacheControl: "private, no-store",
      }),
    )
    if (!res.UploadId) throw new Error("R2 started no upload")
    return new BackupUpload(key, res.UploadId)
  }

  async write(chunk: Uint8Array): Promise<void> {
    this.#buffer.push(chunk)
    this.#buffered += chunk.byteLength
    this.size += chunk.byteLength
    while (this.#buffered >= PART_SIZE) await this.#sendPart(PART_SIZE)
  }

  /** Send the rest and put the parts together. Returns the archive's size. */
  async complete(): Promise<number> {
    if (this.#buffered > 0 || this.#parts.length === 0) await this.#sendPart(this.#buffered)
    await getR2Client().send(
      new CompleteMultipartUploadCommand({
        Bucket: r2Bucket(),
        Key: this.key,
        UploadId: this.#uploadId,
        MultipartUpload: { Parts: this.#parts },
      }),
    )
    return this.size
  }

  /** Drop the parts sent so far. Never throws. */
  async abort(): Promise<void> {
    await getR2Client()
      .send(
        new AbortMultipartUploadCommand({
          Bucket: r2Bucket(),
          Key: this.key,
          UploadId: this.#uploadId,
        }),
      )
      .catch(() => undefined)
  }

  async #sendPart(bytes: number): Promise<void> {
    const all = Buffer.concat(this.#buffer, this.#buffered)
    const body = all.subarray(0, bytes)
    const rest = all.subarray(bytes)
    this.#buffer = rest.byteLength > 0 ? [rest] : []
    this.#buffered = rest.byteLength
    const partNumber = this.#parts.length + 1
    const res = await getR2Client().send(
      new UploadPartCommand({
        Bucket: r2Bucket(),
        Key: this.key,
        UploadId: this.#uploadId,
        PartNumber: partNumber,
        Body: body,
        ContentLength: body.byteLength,
      }),
    )
    if (!res.ETag) throw new Error("R2 returned no ETag for a part")
    this.#parts.push({ PartNumber: partNumber, ETag: res.ETag })
  }
}

/** The stored backups, newest first. Only keys this app creates are listed. */
export async function listBackups(): Promise<StoredBackup[]> {
  return (await listObjects(BACKUP_PREFIX))
    .filter((o) => isBackupKey(o.key))
    .map((o) => ({ key: o.key, size: o.size, created: backupCreatedAt(o.key) }))
    .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0))
}

/** Remove the oldest backups beyond the newest `keep`. */
export async function pruneBackups(keep: number): Promise<void> {
  for (const old of (await listBackups()).slice(keep)) await deleteBackup(old.key)
}

export async function backupExists(key: string): Promise<boolean> {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }))
    return true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}

export async function deleteBackup(key: string): Promise<void> {
  if (!isBackupKey(key)) throw new Error("not a backup key")
  await getR2Client().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }))
}

/** A link that downloads the backup straight from R2, for a few minutes. */
export async function backupDownloadUrl(key: string): Promise<string> {
  if (!isBackupKey(key)) throw new Error("not a backup key")
  return getSignedUrl(getR2Client(), new GetObjectCommand({ Bucket: r2Bucket(), Key: key }), {
    expiresIn: DOWNLOAD_LINK_SECONDS,
  })
}

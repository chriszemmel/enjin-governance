/**
 * In-memory stand-in for the R2 client (`getR2Client().send`) as the backup
 * code drives it: objects, listing in pages, reads streamed in chunks,
 * multipart uploads held to R2's part rules, heads and deletes. No network.
 *
 *   vi.mock("@/lib/r2/client", () => ({ getR2Client: () => fakeR2.client, … }))
 *
 * `calls` records every command; `faults` makes one kind of command throw,
 * as when storage can't be reached.
 */
import { Readable } from "node:stream"
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

type StoredObject = {
  bytes: Buffer
  /** The size a listing reports, when it should differ from the bytes (a huge file). */
  listedSize?: number
  contentType?: string
  contentDisposition?: string
  cacheControl?: string
  modified: Date
}

type Upload = {
  key: string
  contentType?: string
  contentDisposition?: string
  cacheControl?: string
  parts: Map<number, Buffer>
}

type CommandName =
  | "ListObjectsV2"
  | "GetObject"
  | "HeadObject"
  | "DeleteObject"
  | "CreateMultipartUpload"
  | "UploadPart"
  | "CompleteMultipartUpload"
  | "AbortMultipartUpload"

export const objects = new Map<string, StoredObject>()
export const uploads = new Map<string, Upload>()
export const calls: { command: CommandName; key?: string; prefix?: string }[] = []
export const faults: Partial<Record<CommandName, Error>> = {}
/** Sizes of the parts of every completed upload, by key. */
export const completedParts = new Map<string, number[]>()
/** Keys per listing page, and bytes per chunk of a read. */
export const options = { pageSize: 1000, chunkSize: 64 * 1024 }
/** Runs on every read, before the body is returned. */
export const hooks = { onGet: null as null | ((key: string) => void) }

let uploadSeq = 0
const MIN_PART = 5 * 1024 * 1024

export function resetR2(): void {
  objects.clear()
  uploads.clear()
  calls.length = 0
  completedParts.clear()
  for (const k of Object.keys(faults)) delete faults[k as CommandName]
  options.pageSize = 1000
  options.chunkSize = 64 * 1024
  hooks.onGet = null
  uploadSeq = 0
}

export function putObject(
  key: string,
  body: string | Uint8Array,
  opts: { contentType?: string; modified?: Date; listedSize?: number } = {},
): void {
  objects.set(key, {
    bytes: Buffer.from(body),
    listedSize: opts.listedSize,
    contentType: opts.contentType,
    modified: opts.modified ?? new Date("2026-09-01T12:00:00Z"),
  })
}

const notFound = (name: "NoSuchKey" | "NotFound") =>
  Object.assign(new Error(`${name}: missing`), { name })

function record(command: CommandName, details: { key?: string; prefix?: string }) {
  calls.push({ command, ...details })
  const fault = faults[command]
  if (fault) throw fault
}

async function send(cmd: unknown): Promise<unknown> {
  if (cmd instanceof ListObjectsV2Command) {
    const { Prefix = "", ContinuationToken } = cmd.input
    record("ListObjectsV2", { prefix: Prefix })
    const keys = [...objects.keys()].filter((k) => k.startsWith(Prefix)).sort()
    const start = ContinuationToken ? Number(ContinuationToken) : 0
    const page = keys.slice(start, start + options.pageSize)
    const more = start + options.pageSize < keys.length
    return {
      Contents: page.map((Key) => {
        const o = objects.get(Key)!
        return { Key, Size: o.listedSize ?? o.bytes.byteLength, LastModified: o.modified }
      }),
      IsTruncated: more,
      NextContinuationToken: more ? String(start + options.pageSize) : undefined,
    }
  }
  if (cmd instanceof GetObjectCommand) {
    const key = cmd.input.Key!
    record("GetObject", { key })
    hooks.onGet?.(key)
    const o = objects.get(key)
    if (!o) throw notFound("NoSuchKey")
    const chunks: Buffer[] = []
    for (let i = 0; i < o.bytes.byteLength; i += options.chunkSize) {
      chunks.push(o.bytes.subarray(i, i + options.chunkSize))
    }
    return { Body: Readable.from(chunks), ContentType: o.contentType }
  }
  if (cmd instanceof HeadObjectCommand) {
    const key = cmd.input.Key!
    record("HeadObject", { key })
    const o = objects.get(key)
    if (!o) throw notFound("NotFound")
    return { ContentLength: o.bytes.byteLength, ContentType: o.contentType }
  }
  if (cmd instanceof DeleteObjectCommand) {
    const key = cmd.input.Key!
    record("DeleteObject", { key })
    objects.delete(key)
    return {}
  }
  if (cmd instanceof CreateMultipartUploadCommand) {
    const key = cmd.input.Key!
    record("CreateMultipartUpload", { key })
    const id = `upload-${++uploadSeq}`
    uploads.set(id, {
      key,
      contentType: cmd.input.ContentType,
      contentDisposition: cmd.input.ContentDisposition,
      cacheControl: cmd.input.CacheControl,
      parts: new Map(),
    })
    return { UploadId: id }
  }
  if (cmd instanceof UploadPartCommand) {
    const key = cmd.input.Key!
    record("UploadPart", { key })
    const upload = uploads.get(cmd.input.UploadId!)
    if (!upload || upload.key !== key) throw notFound("NoSuchKey")
    const body = Buffer.from(cmd.input.Body as Uint8Array)
    if (cmd.input.ContentLength !== body.byteLength) throw new Error("ContentLength mismatch")
    upload.parts.set(cmd.input.PartNumber!, body)
    return { ETag: `"etag-${cmd.input.PartNumber}"` }
  }
  if (cmd instanceof CompleteMultipartUploadCommand) {
    const key = cmd.input.Key!
    record("CompleteMultipartUpload", { key })
    const upload = uploads.get(cmd.input.UploadId!)
    if (!upload) throw notFound("NoSuchKey")
    const listed = cmd.input.MultipartUpload?.Parts ?? []
    const parts = listed.map((p) => {
      const part = upload.parts.get(p.PartNumber!)
      if (!part || p.ETag !== `"etag-${p.PartNumber}"`) throw new Error("InvalidPart")
      return part
    })
    if (parts.length === 0) throw new Error("MalformedXML: no parts")
    // R2: every part but the last at least 5 MiB, and all of them the same size.
    const sizes = parts.map((p) => p.byteLength)
    const body = sizes.slice(0, -1)
    if (body.some((s) => s < MIN_PART || s !== body[0])) {
      throw Object.assign(new Error("EntityTooSmall"), { name: "EntityTooSmall" })
    }
    objects.set(key, {
      bytes: Buffer.concat(parts),
      contentType: upload.contentType,
      contentDisposition: upload.contentDisposition,
      cacheControl: upload.cacheControl,
      modified: new Date(),
    })
    completedParts.set(key, sizes)
    uploads.delete(cmd.input.UploadId!)
    return {}
  }
  if (cmd instanceof AbortMultipartUploadCommand) {
    const key = cmd.input.Key!
    record("AbortMultipartUpload", { key })
    uploads.delete(cmd.input.UploadId!)
    return {}
  }
  throw new Error(`The fake R2 doesn't handle ${(cmd as object).constructor.name}`)
}

export const client = { send }

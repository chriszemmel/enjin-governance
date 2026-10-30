/**
 * A ZIP archive written as a stream. Entries go in one after another, each
 * read chunk by chunk and handed to the sink as soon as it is compressed,
 * so memory holds a chunk and whatever the sink hasn't taken yet, never
 * the archive.
 *
 * Every entry's size and sha256 are those of its content (uncompressed),
 * for the manifest. The format has no ZIP64 extensions: an archive stays
 * under 4 GiB and 65,535 entries (see ZIP_LIMITS).
 */

import { createHash } from "node:crypto"
import { Zip, ZipDeflate, ZipPassThrough } from "fflate"

/** Where the archive's bytes go, in order. */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>
}

export type ZipEntry = { path: string; size: number; sha256: string }

export const ZIP_LIMITS = {
  /** Offsets and sizes are 32-bit without ZIP64. */
  bytes: 0xffff_ffff,
  entries: 0xffff,
}

/** Text is split into pieces this size, so deflate never works on one huge buffer. */
const TEXT_PIECE = 1024 * 1024

export class ZipWriter {
  readonly #sink: ByteSink
  readonly #zip: Zip
  #pending: Uint8Array[] = []
  #error: Error | null = null
  #ended = false
  /** Bytes of the archive handed to the sink so far. */
  written = 0
  /** Entries added so far. */
  entries = 0

  constructor(sink: ByteSink) {
    this.#sink = sink
    this.#zip = new Zip((err, chunk, final) => {
      if (err) this.#error = err
      else this.#pending.push(chunk)
      if (final) this.#ended = true
    })
  }

  /**
   * Add one entry. `deflate` compresses it; already compressed files (images,
   * PDFs) are stored as they are. `onChunk` runs after each chunk is written
   * and may throw to stop the archive.
   */
  async add(
    path: string,
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    opts: { deflate: boolean; mtime: Date; onChunk?: () => void },
  ): Promise<ZipEntry> {
    const file = opts.deflate ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path)
    file.mtime = opts.mtime
    this.#zip.add(file)
    const hash = createHash("sha256")
    let size = 0
    for await (const chunk of content) {
      if (chunk.byteLength === 0) continue
      hash.update(chunk)
      size += chunk.byteLength
      file.push(chunk)
      await this.#flush()
      opts.onChunk?.()
    }
    file.push(new Uint8Array(0), true)
    await this.#flush()
    this.entries += 1
    return { path, size, sha256: hash.digest("hex") }
  }

  /** Add a text file, deflated (UTF-8). */
  addText(path: string, text: string | Iterable<string>, mtime: Date): Promise<ZipEntry> {
    const parts = typeof text === "string" ? [text] : text
    return this.add(path, textChunks(parts), { deflate: true, mtime })
  }

  /** Write the central directory. The archive is complete once this resolves. */
  async end(): Promise<void> {
    this.#zip.end()
    await this.#flush()
    if (!this.#ended) throw new Error("The ZIP did not finish")
  }

  async #flush(): Promise<void> {
    if (this.#error) throw this.#error
    while (this.#pending.length > 0) {
      const chunk = this.#pending.shift()!
      this.written += chunk.byteLength
      await this.#sink.write(chunk)
    }
  }
}

function* textChunks(parts: Iterable<string>): Iterable<Uint8Array> {
  for (const part of parts) {
    const bytes = Buffer.from(part, "utf8")
    for (let i = 0; i < bytes.byteLength; i += TEXT_PIECE) {
      yield bytes.subarray(i, i + TEXT_PIECE)
    }
  }
}

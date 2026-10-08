/**
 * Builds a full backup: one ZIP, written straight into the bucket.
 *
 *   README.txt         what is inside and how to restore it
 *   db/<table>.json    every table but EXCLUDED_TABLES, as a JSON array
 *   db/restore.sql     puts the rows back into a freshly migrated database
 *   bucket/<key>       every proposal JSON object; uploaded files, thumbnails
 *                      and avatars only when asked for
 *   manifest.json      app version, who and when, the migration ledger, what
 *                      was left out, and the size and sha256 of every file
 *
 * The archive is streamed: tables are read a page at a time, bucket objects
 * one after another in chunks, and the ZIP goes to R2 as a multipart upload
 * (storage.ts). What fits is checked before anything is written; a backup
 * that fails or runs too long is dropped, never left half-written.
 *
 * Progress is kept in a moderation_settings row, so the admins' page can
 * show it from any server while the request runs.
 */

import "server-only"
import { randomBytes } from "node:crypto"
import { z } from "zod"
import packageJson from "@/package.json"
import { getSetting, saveSetting } from "@/lib/db/moderation"
import {
  EXCLUDED_TABLES,
  readMigrations,
  readRows,
  readTables,
  type MigrationEntry,
} from "./database"
import { BACKUPS_KEPT, backupFileName, newBackupKey } from "./keys"
import { restoreSql, tableJson, type BackupTable } from "./restore-sql"
import {
  BackupUpload,
  listObjects,
  pruneBackups,
  readObject,
  type BucketObject,
  type StoredBackup,
} from "./storage"
import { ZIP_LIMITS, ZipWriter, type ZipEntry } from "./zip"

/**
 * The route may run for 300 s (maxDuration). A backup still going after
 * this long is stopped, leaving time to drop the upload and answer.
 */
const TIME_LIMIT_MS = 270_000

/** Room for the headers and the directory at the end of the archive. */
const ZIP_HEADROOM = 64 * 1024 * 1024

const PROGRESS_KEY = "backup_progress"
const PROGRESS_EVERY_MS = 1_000

const MESSAGES = {
  too_large:
    "The backup would be larger than 4 GB, the most one ZIP file can hold. Create it without uploaded files.",
  too_many_files:
    "There are too many files for one ZIP file. Create the backup without uploaded files.",
  too_slow:
    "The backup took too long and was stopped. Nothing was saved. Create it without uploaded files, or try again later.",
  database: "The database couldn't be read. Nothing was saved. Try again later.",
  storage: "Storage couldn't be read or written. Nothing was saved. Try again later.",
} as const

/** A backup that failed, with a sentence that can be shown as it is. */
export class BackupError extends Error {
  readonly reason: keyof typeof MESSAGES

  constructor(reason: keyof typeof MESSAGES, cause?: unknown) {
    super(MESSAGES[reason], { cause })
    this.name = "BackupError"
    this.reason = reason
  }
}

const progressSchema = z.object({
  phase: z.enum(["database", "files", "finishing", "done", "failed"]),
  done: z.number(),
  total: z.number(),
  bytes: z.number(),
  include_media: z.boolean(),
  started_at: z.string(),
})

type BackupProgress = z.infer<typeof progressSchema>

/** The backup running now, if any: null once it finished, failed or stopped. */
export async function readBackupProgress(): Promise<BackupProgress | null> {
  const parsed = progressSchema.safeParse(await getSetting(PROGRESS_KEY).catch(() => null))
  if (!parsed.success) return null
  const p = parsed.data
  if (p.phase === "done" || p.phase === "failed") return null
  // A server stopped mid-backup never writes "failed".
  const age = Date.now() - Date.parse(p.started_at)
  return age >= 0 && age < TIME_LIMIT_MS + 60_000 ? p : null
}

/** Keeps the progress row up to date: at most once a second, and on every phase change. */
class Progress {
  readonly #by: string
  readonly #state: BackupProgress
  #last = 0
  #busy = false
  #queue: Promise<void> = Promise.resolve()

  constructor(state: BackupProgress, by: string) {
    this.#state = state
    this.#by = by
  }

  update(patch: Partial<BackupProgress>): void {
    const phaseChange = patch.phase !== undefined && patch.phase !== this.#state.phase
    Object.assign(this.#state, patch)
    const now = Date.now()
    if (!phaseChange && (this.#busy || now - this.#last < PROGRESS_EVERY_MS)) return
    this.#last = now
    this.#write()
  }

  async finish(phase: "done" | "failed"): Promise<void> {
    this.#state.phase = phase
    this.#write()
    await this.#queue
  }

  #write(): void {
    const value = { ...this.#state }
    this.#busy = true
    this.#queue = this.#queue
      .then(() => saveSetting(PROGRESS_KEY, value, this.#by))
      .catch(() => undefined) // progress is only for show
      .finally(() => {
        this.#busy = false
      })
  }
}

/** Run a step; a failure that isn't already a BackupError becomes `reason`. */
async function step<T>(reason: "database" | "storage", run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw err instanceof BackupError ? err : new BackupError(reason, err)
  }
}

/** Uploaded files, thumbnails and avatars (only with "Include uploaded files"). */
const isUploadedFile = (key: string) =>
  key.startsWith("user-avatars/") || key.includes("/media/") || !key.endsWith(".json")

/** Text compresses; images and PDFs already are, and are stored as they are. */
const isText = (key: string) => /\.(json|txt|csv|md|svg|xml|html?)$/i.test(key)

/** A key that makes a safe path inside the archive (nothing that climbs out of bucket/). */
const isSafeKey = (key: string) =>
  key.length <= 1024 &&
  !/[\\\u0000-\u001f\u007f]/.test(key) &&
  key.split("/").every((s) => s !== "" && s !== "." && s !== "..")

/** A table's file in the archive. Table names are plain identifiers; anything else is escaped. */
const tablePath = (name: string) =>
  `db/${/^[A-Za-z0-9_]+$/.test(name) ? name : encodeURIComponent(name)}.json`

type Skipped = { key: string; reason: string }

/** The bucket objects that go in, and the ones that can't. */
async function bucketContents(
  includeMedia: boolean,
): Promise<{ objects: BucketObject[]; skipped: Skipped[] }> {
  const found = [
    ...(await listObjects("proposals/")),
    ...(includeMedia ? await listObjects("user-avatars/") : []),
  ].filter((o) => includeMedia || !isUploadedFile(o.key))
  return {
    objects: found.filter((o) => isSafeKey(o.key)),
    skipped: found
      .filter((o) => !isSafeKey(o.key))
      .map((o) => ({ key: o.key, reason: "The key can't be a file name in a ZIP." })),
  }
}

function readme(a: {
  createdAt: string
  createdBy: string
  includeMedia: boolean
  tables: { name: string; rows: number }[]
}): string {
  return `Enjin Governance backup
=======================

Created ${a.createdAt} by the admin with public key ${a.createdBy}.
App version ${packageJson.version}.

THIS ARCHIVE CONTAINS PERSONAL DATA: user profiles, comments, proposal
drafts, moderation reports and decisions, and security reports with the
contact details their senders left. Store it as carefully as the
production database, and delete copies you no longer need.

Contents
--------
- manifest.json: what is in the archive. The app version, the migrations
  the database had, what was left out, and the size and SHA-256 of every
  file.
- db/<table>.json: every table as a JSON array, one object per row.
  BIGINT and NUMERIC values are strings; timestamps are ISO 8601 with
  their microseconds.
- db/restore.sql: puts the rows back into a database (below).
- bucket/: storage objects under their original keys. Every proposal JSON
  file; ${
    a.includeMedia
      ? "uploaded files, thumbnails and avatars too."
      : "uploaded files, thumbnails and avatars were not included."
  }

Not included: ${Object.keys(EXCLUDED_TABLES).join(" and ")} (sign-in sessions and
sign-in challenges). Everyone signs in again after a restore.

Tables (rows): ${a.tables.map((t) => `${t.name} (${t.rows})`).join(", ")}.

Restore the database
--------------------
1. Create an empty Postgres database (for example a new Neon branch).
2. From the repository, at the same app version, apply the schema up to
   the last migration manifest.json lists (this backup's database had
   exactly those), e.g. for 013:
     DATABASE_URL_UNPOOLED="<database url>" pnpm db:migrate --until 013
3. Load the data:
     psql "<database url>" -v ON_ERROR_STOP=1 -f db/restore.sql
   It runs in one transaction, parents before the tables that refer to
   them: either every row is restored or none is. Rows that already exist
   are left as they are.
4. Apply any later migrations: pnpm db:migrate

Restore the files
-----------------
Copy the contents of bucket/ into the new bucket, keeping every key as it
is (keys appear in proposal JSON, in the database and in moderation
records). For example with rclone or the AWS CLI against R2:
  rclone copy bucket/ <remote>:<bucket>
  aws s3 sync bucket/ s3://<bucket> --endpoint-url <R2 endpoint>

Check the archive
-----------------
Each file's SHA-256 (sha256sum <file>) must match manifest.json.
`
}

/**
 * Create a backup and store it. Returns the stored archive; throws a
 * BackupError (whose message can be shown) or, rarely, anything else.
 */
export async function createBackup(opts: {
  includeMedia: boolean
  /** The admin's public key, recorded in the manifest. */
  createdBy: string
}): Promise<StoredBackup> {
  // Whole seconds, so the time in the key and in the manifest agree.
  const started = new Date(Math.floor(Date.now() / 1000) * 1000)
  const createdAt = started.toISOString()
  const deadline = started.getTime() + TIME_LIMIT_MS
  const checkTime = () => {
    if (Date.now() > deadline) throw new BackupError("too_slow")
  }
  const progress = new Progress(
    {
      phase: "database",
      done: 0,
      total: 0,
      bytes: 0,
      include_media: opts.includeMedia,
      started_at: createdAt,
    },
    opts.createdBy,
  )
  progress.update({ phase: "database" })

  let upload: BackupUpload | null = null
  try {
    // What goes in, and whether it can fit, before anything is written.
    const { objects, skipped } = await step("storage", () => bucketContents(opts.includeMedia))
    const tables = await step("database", readTables)
    if (objects.length + tables.length + 4 > ZIP_LIMITS.entries) {
      throw new BackupError("too_many_files")
    }
    const maxBytes = ZIP_LIMITS.bytes - ZIP_HEADROOM
    if (objects.reduce((sum, o) => sum + o.size, 0) > maxBytes) throw new BackupError("too_large")

    // The database, children before parents: a row added while this runs
    // can then only miss its own children, never find its parent missing.
    const migrations: MigrationEntry[] | null = await step("database", readMigrations)
    const data = new Map<string, BackupTable>()
    progress.update({ total: tables.length })
    for (const t of [...tables].reverse()) {
      checkTime()
      data.set(t.name, { ...t, rows: await step("database", () => readRows(t)) })
      progress.update({ done: data.size })
    }
    const ordered = tables.map((t) => data.get(t.name)!)
    data.clear()

    const key = newBackupKey(started, randomBytes(16).toString("hex"))
    upload = await step("storage", () => BackupUpload.open(key, backupFileName(key)))
    const zip = new ZipWriter(upload)
    const files: ZipEntry[] = []
    const write = (run: () => Promise<ZipEntry>) =>
      step("storage", run).then((entry) => {
        files.push(entry)
        return entry
      })

    const tableSummary = ordered.map((t) => ({ name: t.name, rows: t.rows.length }))
    await write(() =>
      zip.addText("README.txt", readme({ ...opts, createdAt, tables: tableSummary }), started),
    )
    for (const t of ordered) {
      checkTime()
      await write(() => zip.addText(tablePath(t.name), tableJson(t.rows), started))
    }
    await write(() =>
      zip.addText(
        "db/restore.sql",
        restoreSql(ordered, { createdAt, appVersion: packageJson.version }),
        started,
      ),
    )
    ordered.length = 0

    progress.update({ phase: "files", done: 0, total: objects.length, bytes: zip.written })
    let done = 0
    for (const o of objects) {
      checkTime()
      if (zip.written + o.size > maxBytes) throw new BackupError("too_large")
      const body = await step("storage", () => readObject(o.key))
      if (body) {
        await write(() =>
          zip.add(`bucket/${o.key}`, body, {
            deflate: isText(o.key),
            mtime: o.modified ?? started,
            onChunk: checkTime,
          }),
        )
      } else {
        skipped.push({ key: o.key, reason: "Deleted while the backup ran." })
      }
      progress.update({ done: ++done, bytes: zip.written })
    }

    const manifest = {
      format: "enjin-governance-backup",
      format_version: 1,
      app_version: packageJson.version,
      created_at: createdAt,
      created_by: opts.createdBy,
      include_media: opts.includeMedia,
      migrations,
      database: {
        restore: "db/restore.sql",
        restore_order: tableSummary.map((t) => t.name),
        tables: tableSummary.map((t) => ({ ...t, path: tablePath(t.name) })),
        excluded_tables: Object.entries(EXCLUDED_TABLES).map(([name, reason]) => ({
          name,
          reason,
        })),
      },
      bucket: {
        objects: files.filter((f) => f.path.startsWith("bucket/")).length,
        uploaded_files_included: opts.includeMedia,
        skipped,
      },
      files,
    }
    progress.update({ phase: "finishing", bytes: zip.written })
    await step("storage", () =>
      zip.addText("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, started),
    )
    await step("storage", () => zip.end())
    if (zip.written > ZIP_LIMITS.bytes) throw new BackupError("too_large")
    const size = await step("storage", () => upload!.complete())
    upload = null
    await progress.finish("done")

    // Keep the newest few. A failure here leaves one too many, nothing worse.
    await pruneBackups(BACKUPS_KEPT).catch(() => undefined)
    return { key, size, created: createdAt }
  } catch (err) {
    await upload?.abort()
    await progress.finish("failed")
    throw err
  }
}

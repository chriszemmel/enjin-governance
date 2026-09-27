/**
 * /api/moderation/backup (admins)
 *
 *   GET     the stored backups (key, size, created) and the one running now
 *   POST    { include_media } create one: a ZIP of the database and the
 *           bucket, written straight into R2 (lib/backup). At most one every
 *           10 minutes across all servers; the newest 5 are kept.
 *   DELETE  { key } remove one
 *
 * GET /api/moderation/backup/download hands out a short-lived link to a
 * backup. Answers carry keys, sizes and dates only, and errors are fixed
 * sentences: nothing from the environment or a raw error reaches them.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth/roles"
import { BackupError, createBackup, readBackupProgress } from "@/lib/backup/create"
import { BACKUPS_KEPT, isBackupKey } from "@/lib/backup/keys"
import { backupExists, deleteBackup, listBackups } from "@/lib/backup/storage"
import { claimSlot } from "@/lib/moderation/slots"
import { isR2Configured } from "@/lib/r2/client"

export const runtime = "nodejs"
// Streaming a large bucket into the archive takes a while (see lib/backup/create.ts).
export const maxDuration = 300

const WINDOW_MS = 10 * 60_000

const STATUS: Record<BackupError["reason"], number> = {
  too_large: 413,
  too_many_files: 413,
  too_slow: 504,
  database: 502,
  storage: 502,
}

const fail = (status: number, error: string, headers: Record<string, string> = {}) =>
  NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  )

const NO_STORAGE = "Storage isn't configured. Backups are kept in R2."
const STORAGE_DOWN = "Storage couldn't be reached. Try again later."
const NOT_A_BACKUP = "That isn't a backup."

/** The JSON body; {} when there is none, null when it isn't JSON. */
async function readBody(request: NextRequest): Promise<unknown> {
  const text = await request.text().catch(() => "")
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function GET(): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  if (!isR2Configured()) return fail(503, NO_STORAGE)
  try {
    const [items, running] = await Promise.all([listBackups(), readBackupProgress()])
    return NextResponse.json(
      { ok: true, items, running, keep: BACKUPS_KEPT },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return fail(502, STORAGE_DOWN)
  }
}

const createSchema = z.object({ include_media: z.boolean().default(false) }).strict()

export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  if (!isR2Configured()) return fail(503, NO_STORAGE)
  const body = createSchema.safeParse(await readBody(request))
  if (!body.success) return fail(400, "Say whether to include uploaded files.")

  if (!(await claimSlot("backup", WINDOW_MS, admin.publicKey))) {
    return fail(
      429,
      "One backup every 10 minutes: the last one was started less than 10 minutes ago. Try again later.",
      { "Retry-After": String(WINDOW_MS / 1000) },
    )
  }
  try {
    const backup = await createBackup({
      includeMedia: body.data.include_media,
      createdBy: admin.publicKey,
    })
    return NextResponse.json({ ok: true, backup }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    // The server log gets the cause; the answer only a fixed sentence.
    const cause = err instanceof BackupError ? err.cause : err
    console.error(
      `[moderation/backup] failed (${err instanceof BackupError ? err.reason : "unexpected"})`,
      cause instanceof Error ? cause.message : "",
    )
    if (err instanceof BackupError) return fail(STATUS[err.reason], err.message)
    return fail(500, "The backup failed. Nothing was saved. Try again later.")
  }
}

const deleteSchema = z.object({ key: z.string().max(200) }).strict()

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  if (!isR2Configured()) return fail(503, NO_STORAGE)
  const body = deleteSchema.safeParse(await readBody(request))
  if (!body.success || !isBackupKey(body.data.key)) return fail(400, NOT_A_BACKUP)
  try {
    if (!(await backupExists(body.data.key))) {
      return fail(404, "That backup doesn't exist anymore.")
    }
    await deleteBackup(body.data.key)
  } catch {
    return fail(502, STORAGE_DOWN)
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}

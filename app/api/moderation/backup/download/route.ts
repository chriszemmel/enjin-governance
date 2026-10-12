/**
 * GET /api/moderation/backup/download?key=backups/… (admins)
 *
 * Redirects to a signed R2 link for one backup, valid for a few minutes.
 * The archive can be gigabytes, far more than a function response may
 * carry, so the browser downloads it from R2 directly. Only keys of the
 * shape the backup route creates are accepted (lib/backup/keys.ts).
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireRole } from "@/lib/auth/roles"
import { isBackupKey } from "@/lib/backup/keys"
import { backupDownloadUrl, backupExists } from "@/lib/backup/storage"
import { isR2Configured } from "@/lib/r2/client"

export const runtime = "nodejs"

const fail = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } })

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  if (!isR2Configured()) return fail(503, "Storage isn't configured. Backups are kept in R2.")
  const key = new URL(request.url).searchParams.get("key")
  if (!isBackupKey(key)) return fail(400, "That isn't a backup.")

  let url: string
  try {
    if (!(await backupExists(key))) return fail(404, "That backup doesn't exist anymore.")
    url = await backupDownloadUrl(key)
  } catch {
    return fail(502, "Storage couldn't be reached. Try again later.")
  }
  const res = NextResponse.redirect(url, 303)
  // The link is a credential for a few minutes: keep it out of caches and referrers.
  res.headers.set("Cache-Control", "no-store")
  res.headers.set("Referrer-Policy", "no-referrer")
  return res
}

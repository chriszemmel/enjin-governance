/**
 * Where backups are kept in the bucket, and which keys the backup routes
 * accept.
 *
 * Backups live under `backups/`, a prefix the public `/r` route never
 * serves (see isPublicReadableKey in lib/r2/paths). They are only reached
 * through the admin routes, as a signed link that expires in minutes.
 *
 *   backups/2026-09-26T09:00:00Z-<32 random hex digits>.zip
 *
 * Only keys of exactly this shape are listed, downloaded or deleted, so a
 * key from the browser can't name anything else in the bucket. The random
 * part (128 bits) also keeps a backup out of reach where the bucket's
 * public r2.dev URL is switched on: that URL serves any object whose exact
 * key is known, but never lists them.
 */

export const BACKUP_PREFIX = "backups/"

/** How many backups are kept; creating one more removes the oldest. */
export const BACKUPS_KEPT = 5

const KEY = /^backups\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)-[0-9a-f]{32}\.zip$/

/** A new backup's key: when it was started, and 32 random hex digits. */
export function newBackupKey(startedAt: Date, random: string): string {
  if (!/^[0-9a-f]{32}$/.test(random)) throw new Error("random must be 32 hex digits")
  return `${BACKUP_PREFIX}${startedAt.toISOString().slice(0, 19)}Z-${random}.zip`
}

/** Whether a value is a backup key this app created (and nothing else). */
export function isBackupKey(key: unknown): key is string {
  return typeof key === "string" && KEY.test(key)
}

/** When a backup was started (ISO), read from its key. */
export function backupCreatedAt(key: string): string {
  const m = KEY.exec(key)
  if (!m) throw new Error("not a backup key")
  return new Date(m[1]).toISOString()
}

/** The file name a download is saved under: no colons, which Windows refuses. */
export function backupFileName(key: string): string {
  return `enjin-governance-backup-${backupCreatedAt(key).slice(0, 19).replace(/:/g, "-")}Z.zip`
}

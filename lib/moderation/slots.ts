/**
 * "At most once per window" gates, for things like the Telegram test
 * message (once a minute) and the content-check alert (once a day).
 *
 * Shared across servers through a moderation_settings row, claimed in one
 * statement. When the database can't be reached, each server keeps its
 * own gate in memory, so a gate never opens wider than once per window
 * per server.
 */

import "server-only"
import { claimSettingSlot } from "@/lib/db/moderation"

const local = new Map<string, number>()

/** True, and claimed, when nothing claimed `key` in the last `windowMs`. Never throws. */
export async function claimSlot(key: string, windowMs: number, by: string): Promise<boolean> {
  const now = Date.now()
  const last = local.get(key)
  if (last !== undefined && now - last < windowMs) return false
  let claimed: boolean
  try {
    claimed = await claimSettingSlot(`slot:${key}`, windowMs / 1000, by)
  } catch {
    claimed = true
  }
  if (claimed) local.set(key, now)
  return claimed
}

/** Test hook: forget the in-memory gates. */
export function resetSlots(): void {
  local.clear()
}

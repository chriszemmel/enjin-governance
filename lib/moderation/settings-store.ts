/**
 * Reading and saving the content-check settings (patch v1.7), and the
 * per-check decision "should this item be checked, and with which model".
 *
 * Settings live in moderation_settings and are cached for 30 seconds per
 * server instance, so a change applies everywhere within about a minute.
 * If the settings table doesn't exist (migration 012 not applied) the
 * defaults apply, which means checks are off. A database error keeps the
 * settings this server last read and tries again a few seconds later, so
 * a short outage can't switch the checks off.
 */

import "server-only"
import { env } from "@/lib/env"
import { isMissingTable } from "@/lib/db/errors"
import { addScanTokens, getSetting, reserveScanCheck, saveSetting } from "@/lib/db/moderation"
import {
  parseStoredSettings,
  DEFAULT_SCAN_SETTINGS,
  type ScanKind,
  type ScanModel,
  type ScanSettings,
} from "./scan-settings"
import type { ScanOutcome } from "./scan"

const SETTINGS_KEY = "content_scan"
const CACHE_MS = 30_000
/** After a failed read, the next attempt comes this much sooner. */
const RETRY_MS = 5_000

let cached: { at: number; value: ScanSettings } | null = null

export async function getScanSettings(): Promise<ScanSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  try {
    const value = parseStoredSettings(await getSetting(SETTINGS_KEY))
    cached = { at: Date.now(), value }
    return value
  } catch (err) {
    if (isMissingTable(err)) {
      // Migration 012 not applied: checks are off.
      cached = { at: Date.now(), value: DEFAULT_SCAN_SETTINGS }
      return DEFAULT_SCAN_SETTINGS
    }
    // Database down: keep what this server last read (off if it never read
    // any), and try again in a few seconds.
    const value = cached?.value ?? DEFAULT_SCAN_SETTINGS
    cached = { at: Date.now() - CACHE_MS + RETRY_MS, value }
    return value
  }
}

export async function saveScanSettings(value: ScanSettings, by: string): Promise<void> {
  await saveSetting(SETTINGS_KEY, value, by)
  cached = { at: Date.now(), value }
}

/**
 * The saved settings straight from the database, and the model admins
 * saved (which may no longer be offered). Throws when they can't be read.
 */
export async function loadScanSettings(): Promise<{
  settings: ScanSettings
  savedModel: string | null
}> {
  const raw = await getSetting(SETTINGS_KEY)
  const model = raw && typeof raw === "object" ? (raw as { model?: unknown }).model : undefined
  return {
    settings: parseStoredSettings(raw),
    savedModel: typeof model === "string" ? model : null,
  }
}

type ScanPlan = { model: ScanModel; settings: ScanSettings }

/**
 * The model to check an item of this kind with, or null when items of this
 * kind aren't checked: no API key, checks off, or this kind switched off.
 */
export async function scanPlan(kind: ScanKind): Promise<ScanPlan | null> {
  if (!env.ANTHROPIC_API_KEY) return null
  const settings = await getScanSettings()
  if (!settings.enabled || !settings[kind]) return null
  return { model: settings.model, settings }
}

/**
 * Count one check against today's limit, before it is sent. False when
 * the limit is reached, and when the check can't be counted at all (the
 * database is failing): the daily limit is a hard cap. Callers hold
 * uploads for a person instead, and skip text.
 */
export async function reserveScan(kind: ScanKind, plan: ScanPlan): Promise<boolean> {
  try {
    return await reserveScanCheck(plan.model, kind, plan.settings.dailyLimit)
  } catch {
    return false
  }
}

/** Add a finished check's tokens to the usage; never throws. */
export async function noteScanUsage(
  kind: ScanKind,
  model: ScanModel,
  outcome: ScanOutcome,
): Promise<void> {
  if (!outcome.usage) return
  await addScanTokens({
    model,
    kind,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
  }).catch(() => undefined)
}

/** Test hook: forget the cached settings. */
export function resetScanSettingsCache(): void {
  cached = null
}

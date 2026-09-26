/**
 * Reading and saving the content-check settings (patch v1.7), and the
 * per-check decision "should this item be checked, and with which model".
 *
 * Settings live in moderation_settings and are cached for 30 seconds per
 * server instance, so a change applies everywhere within about a minute.
 * If the database can't be read the defaults apply, which means checks
 * are off.
 */

import "server-only"
import { env } from "@/lib/env"
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

let cached: { at: number; value: ScanSettings } | null = null

export async function getScanSettings(): Promise<ScanSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  let value = DEFAULT_SCAN_SETTINGS
  try {
    value = parseStoredSettings(await getSetting(SETTINGS_KEY))
  } catch {
    // Table missing (migration 012 not applied) or database down: off.
  }
  cached = { at: Date.now(), value }
  return value
}

export async function saveScanSettings(value: ScanSettings, by: string): Promise<void> {
  await saveSetting(SETTINGS_KEY, value, by)
  cached = { at: Date.now(), value }
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
 * the limit is reached: callers hold uploads for a person instead.
 */
export async function reserveScan(kind: ScanKind, plan: ScanPlan): Promise<boolean> {
  try {
    return (await reserveScanCheck(plan.model, kind)) <= plan.settings.dailyLimit
  } catch {
    // Can't count: check anyway. Posting needs the database too, so this
    // only happens briefly.
    return true
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

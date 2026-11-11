/**
 * Health of the automatic content checks (v1.9).
 *
 * A check that fails because of this site's setup - the API key refused,
 * the model retired, the account out of credit - lets the upload through
 * unchecked, like an outage. Unlike an outage it won't pass by itself, so
 * it is recorded (moderation_settings, key "content_scan_health"), shown
 * to admins on the Status and Settings tabs, and announced in the
 * moderators' Telegram chat (at most once a day). The next check that gets
 * an answer clears it. Timeouts, server errors, overload and rate limits
 * are outages and leave the record alone, as do items the API refused as
 * input.
 *
 * Writes happen only when the state changes, plus a "last seen" refresh at
 * most every 15 minutes while a problem lasts. Each server keeps the record
 * in memory and re-reads it every 5 minutes, so a busy day costs a handful
 * of writes, not one per check.
 */

import "server-only"
import { z } from "zod"
import { getSetting, saveSetting } from "@/lib/db/moderation"
import { notifyScanProblem } from "./notify"
import type { ScanOutcome } from "./scan"

const SCAN_PROBLEMS = ["api_key", "permission", "model", "billing", "request"] as const
export type ScanProblem = (typeof SCAN_PROBLEMS)[number]

/** One or two short sentences per problem, for admins and the Telegram notice. */
export const SCAN_PROBLEM_TEXT: Record<ScanProblem, string> = {
  api_key: "The API key was refused. Check ANTHROPIC_API_KEY.",
  permission: "The API key isn't allowed to use the chosen model.",
  model: "The chosen model wasn't found. It may be retired: pick another one in Settings.",
  billing: "The Anthropic account is out of credit.",
  request: "The API no longer accepts the request this app sends. The app needs an update.",
}

const healthSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), since: z.string() }),
  z.object({
    state: z.literal("failing"),
    problem: z.enum(SCAN_PROBLEMS),
    firstSeen: z.string(),
    lastSeen: z.string(),
  }),
])

export type ScanHealth = z.infer<typeof healthSchema>

type Observation = { kind: "ok" } | { kind: "failing"; problem: ScanProblem }

/** What a finished check says about the setup; null when it says nothing. */
function observe(outcome: ScanOutcome): Observation | null {
  if (outcome.kind === "verdict" || outcome.kind === "refused") return { kind: "ok" }
  if (outcome.cause === "config") return { kind: "failing", problem: outcome.problem }
  return null
}

const HEALTH_KEY = "content_scan_health"
const REFRESH_MS = 15 * 60_000
const REREAD_MS = 5 * 60_000

/**
 * Pure: the record to write after an observation (null: nothing to write),
 * and whether it reports a new problem.
 */
export function nextHealth(
  prev: ScanHealth | null,
  obs: Observation,
  now: Date,
): { write: ScanHealth | null; newProblem: boolean } {
  const at = now.toISOString()
  if (obs.kind === "ok") {
    return {
      write: prev?.state === "failing" ? { state: "ok", since: at } : null,
      newProblem: false,
    }
  }
  if (prev?.state === "failing" && prev.problem === obs.problem) {
    const fresh = now.getTime() - Date.parse(prev.lastSeen) < REFRESH_MS
    return { write: fresh ? null : { ...prev, lastSeen: at }, newProblem: false }
  }
  return {
    write: { state: "failing", problem: obs.problem, firstSeen: at, lastSeen: at },
    newProblem: true,
  }
}

/** The stored record (null when there is none); throws when it can't be read. */
export async function readScanHealth(): Promise<ScanHealth | null> {
  const parsed = healthSchema.safeParse(await getSetting(HEALTH_KEY))
  return parsed.success ? parsed.data : null
}

let cache: { value: ScanHealth | null; at: number } | null = null
let queue: Promise<void> = Promise.resolve()

async function known(now: number): Promise<ScanHealth | null> {
  if (cache && now - cache.at < REREAD_MS) return cache.value
  try {
    const value = await readScanHealth()
    cache = { value, at: now }
    return value
  } catch {
    // Can't read it: go on from what this server last knew.
    return cache?.value ?? null
  }
}

async function apply(obs: Observation): Promise<void> {
  const now = new Date()
  const { write, newProblem } = nextHealth(await known(now.getTime()), obs, now)
  if (!write) return
  // Remembered even if the write fails, so a database outage doesn't
  // turn into a write attempt per check; the next re-read corrects it.
  cache = { value: write, at: now.getTime() }
  await saveSetting(HEALTH_KEY, write, "automatic check").catch(() => undefined)
  if (newProblem && write.state === "failing") {
    await notifyScanProblem(SCAN_PROBLEM_TEXT[write.problem])
  }
}

/** Record what a finished check says about the setup. Never throws. */
export function noteScanHealth(outcome: ScanOutcome): Promise<void> {
  const obs = observe(outcome)
  if (!obs) return Promise.resolve()
  // Nothing new, as far as this server knows: no I/O, no waiting.
  const now = new Date()
  if (cache && now.getTime() - cache.at < REREAD_MS && !nextHealth(cache.value, obs, now).write) {
    return Promise.resolve()
  }
  // One update at a time per server, so parallel checks don't race.
  queue = queue.then(() => apply(obs)).catch(() => undefined)
  return queue
}

/** Test hook: forget what this server knows. */
export function resetScanHealthCache(): void {
  cache = null
  queue = Promise.resolve()
}

/**
 * Gathers the inputs for the admins' Status tab (status.ts): which
 * settings are present, what the database says, and the content-check
 * health. Only presence and labels leave this module - never a value from
 * the environment, and never an error message (a database error can name
 * the host).
 */

import "server-only"
import { isDbConfigured } from "@/lib/db/client"
import { moderationSchema, pingDatabase, scanChecksToday } from "@/lib/db/moderation"
import { env } from "@/lib/env"
import { isPublicUrlMisconfigured, isR2Configured } from "@/lib/r2/client"
import { moderationChat } from "./notify"
import { readScanHealth, SCAN_PROBLEM_TEXT } from "./scan-health"
import { loadScanSettings } from "./settings-store"
import type { StatusInputs } from "./status"

const has = (v: string | undefined) => Boolean(v?.trim())

/** Vercel's production deployment, or NODE_ENV=production elsewhere. */
function isProduction(): boolean {
  const vercel = process.env.VERCEL_ENV
  return vercel ? vercel === "production" : process.env.NODE_ENV === "production"
}

/** The same test lib/rate-limit.ts makes before using the shared store. */
function sharedRateLimitStore(): boolean {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  return Boolean(url && token)
}

const R2_VARIABLES = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
  "R2_PUBLIC_URL",
] as const

function legalEmail(): StatusInputs["legal"]["email"] {
  // lib/env.ts has a default address; only an explicit one counts.
  const raw = process.env.LEGAL_CONTACT_EMAIL?.trim()
  if (!raw) return "missing"
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? "set" : "invalid"
}

async function scanHealth(): Promise<StatusInputs["scan"]["health"]> {
  try {
    const h = await readScanHealth()
    if (h?.state !== "failing") return { state: "ok" }
    return {
      state: "failing",
      problem: SCAN_PROBLEM_TEXT[h.problem],
      first_seen: h.firstSeen,
      last_seen: h.lastSeen,
    }
  } catch {
    return null
  }
}

async function databaseReachable(): Promise<boolean> {
  try {
    await pingDatabase()
    return true
  } catch {
    return false
  }
}

export async function gatherStatusInputs(): Promise<StatusInputs> {
  const configured = isDbConfigured()
  const reachable = configured && (await databaseReachable())
  const [schema, stored, checksToday, health] = reachable
    ? await Promise.all([
        moderationSchema().catch(() => null),
        loadScanSettings().catch(() => null),
        scanChecksToday().catch(() => null),
        scanHealth(),
      ])
    : [null, null, null, null]

  return {
    production: isProduction(),
    database: { configured, reachable, schema },
    storage: {
      configured: isR2Configured(),
      missing: R2_VARIABLES.filter((name) => !has(env[name])),
    },
    appUrl: {
      value: env.NEXT_PUBLIC_APP_URL,
      set: has(process.env.NEXT_PUBLIC_APP_URL),
      refused: isPublicUrlMisconfigured(),
    },
    rateLimit: { shared: sharedRateLimitStore() },
    telegram: {
      token: has(env.TELEGRAM_BOT_TOKEN),
      securityChat: has(env.TELEGRAM_CHAT_ID),
      moderationChat: moderationChat().kind,
    },
    scan: {
      apiKey: has(env.ANTHROPIC_API_KEY),
      settings: stored?.settings ?? null,
      savedModel: stored?.savedModel ?? null,
      checksToday,
      health,
    },
    legal: {
      name: has(env.LEGAL_OPERATOR_NAME),
      email: legalEmail(),
      address: has(env.LEGAL_OPERATOR_ADDRESS),
    },
    walletConnect: has(env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
  }
}

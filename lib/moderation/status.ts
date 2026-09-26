/**
 * The admins' Status tab (v1.9): a checklist of what this deployment needs,
 * each item ok / warning / problem with a one-line hint.
 *
 * Pure: the inputs are booleans and labels gathered by status-probe.ts, so
 * no secret value can reach the report. Hints name environment variables,
 * never their values.
 */

import {
  SCAN_KINDS,
  SCAN_MODEL_IDS,
  SCAN_MODELS,
  type ScanModel,
  type ScanSettings,
} from "./scan-settings"

export type StatusLevel = "ok" | "warning" | "problem"
type StatusItem = { id: string; label: string; level: StatusLevel; hint: string }
type StatusSection = { id: string; title: string; items: StatusItem[] }

/** A recorded content-check failure, as admins see it. */
type HealthView = { problem: string; first_seen: string; last_seen: string }

export type StatusInputs = {
  /** Vercel production, or NODE_ENV=production off Vercel. */
  production: boolean
  database: {
    configured: boolean
    reachable: boolean
    /** Null when it couldn't be read. */
    schema: {
      moderation: boolean
      settings: boolean
      keepState: boolean
      ledger: string[] | null
    } | null
  }
  storage: { configured: boolean; missing: string[] }
  /**
   * NEXT_PUBLIC_APP_URL as the app uses it, whether it was set at all, and
   * whether the app refuses to build file links from it (lib/r2/client.ts).
   */
  appUrl: { value: string; set: boolean; refused: boolean }
  rateLimit: { shared: boolean }
  telegram: {
    token: boolean
    securityChat: boolean
    moderationChat: "own" | "security" | "off" | "none"
  }
  scan: {
    apiKey: boolean
    /** Null when the settings couldn't be read. */
    settings: ScanSettings | null
    savedModel: string | null
    checksToday: number | null
    /** Null when the record couldn't be read; "ok" also when there is none. */
    health: { state: "ok" } | ({ state: "failing" } & HealthView) | null
  }
  legal: { name: boolean; email: "set" | "invalid" | "missing"; address: boolean }
  walletConnect: boolean
}

export type StatusReport = {
  production: boolean
  sections: StatusSection[]
  /** The content-check failure, for the banner on the Settings tab. */
  health: HealthView | null
  /** Whether the Telegram test message has somewhere to go. */
  can_send_test: boolean
}

const item = (id: string, label: string, level: StatusLevel, hint: string): StatusItem => ({
  id,
  label,
  level,
  hint,
})

/** "2026-09-26 09:12 UTC". */
export function formatUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "an unknown time"
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

/** True for localhost, loopback and unspecified addresses (and unreadable URLs). */
export function isLocalUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return true
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "[::]" ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  )
}

// ---- database ------------------------------------------------------------------

const MIGRATIONS = [
  { id: "migration-011", n: "011", label: "Migration 011: moderation", key: "moderation" },
  { id: "migration-012", n: "012", label: "Migration 012: check settings", key: "settings" },
  { id: "migration-013", n: "013", label: "Migration 013: keep decisions", key: "keepState" },
] as const

function databaseSection(db: StatusInputs["database"]): StatusSection {
  const items = [
    !db.configured
      ? item(
          "database",
          "Database",
          "problem",
          "Not set up. Set DATABASE_URL; sign-in, drafts and moderation need it.",
        )
      : !db.reachable
        ? item("database", "Database", "problem", "Can't be reached right now.")
        : item("database", "Database", "ok", "Reachable."),
  ]
  for (const m of MIGRATIONS) {
    const schema = db.schema
    if (!schema) {
      items.push(item(m.id, m.label, "warning", "Can't check without the database."))
      continue
    }
    const listed = schema.ledger?.some((f) => f.startsWith(`${m.n}_`)) ?? false
    if (schema[m.key]) {
      items.push(
        item(
          m.id,
          m.label,
          "ok",
          listed
            ? "Applied."
            : "Applied. Its tables are in place but not in the migrations ledger, so it was probably applied by hand.",
        ),
      )
    } else {
      items.push(
        item(
          m.id,
          m.label,
          "problem",
          listed
            ? `The ledger lists it, but its tables are missing. Run scripts/${m.n}_*.sql again.`
            : "Not applied. Run pnpm db:migrate.",
        ),
      )
    }
  }
  return { id: "database", title: "Database", items }
}

// ---- storage and links ---------------------------------------------------------

function storageSection(i: StatusInputs): StatusSection {
  const storage = i.storage.configured
    ? item("storage", "Storage (R2)", "ok", "Set up. Uploads and proposal files work.")
    : item(
        "storage",
        "Storage (R2)",
        "problem",
        `Not set up. Missing: ${i.storage.missing.join(", ") || "R2 settings"}. Proposals can't be filed without it.`,
      )

  let base: StatusItem
  const label = "Public URL base"
  const local = isLocalUrl(i.appUrl.value)
  if (i.appUrl.refused) {
    base = item(
      "app-url",
      label,
      "problem",
      "Points at localhost, so uploads and new proposals are refused. Set NEXT_PUBLIC_APP_URL to the site's domain: file links are pinned on chain in EGOV1 records.",
    )
  } else if (!i.appUrl.set && i.production) {
    base = item(
      "app-url",
      label,
      "problem",
      "NEXT_PUBLIC_APP_URL isn't set, so file links point at localhost. They are pinned on chain in EGOV1 records: set the site's domain first.",
    )
  } else if (local && i.production) {
    base = item(
      "app-url",
      label,
      "problem",
      "Points at localhost. File links are pinned on chain in EGOV1 records: set NEXT_PUBLIC_APP_URL to the site's domain first.",
    )
  } else if (local) {
    base = item(
      "app-url",
      label,
      "ok",
      "Localhost. Fine for development; set the real domain before anyone files a proposal.",
    )
  } else {
    const origin = new URL(i.appUrl.value).origin
    base =
      i.production && !origin.startsWith("https://")
        ? item(
            "app-url",
            label,
            "warning",
            `${origin} uses http. Links pinned on chain should use https.`,
          )
        : item("app-url", label, "ok", `File links use ${origin}/r.`)
  }
  return { id: "storage", title: "Storage and links", items: [storage, base] }
}

function rateLimitSection(i: StatusInputs): StatusSection {
  const label = "Rate-limit store"
  const it = i.rateLimit.shared
    ? item("rate-limit", label, "ok", "Shared store. Limits hold across all server instances.")
    : i.production
      ? item(
          "rate-limit",
          label,
          "warning",
          "In memory: each server instance counts on its own. Set KV_REST_API_URL and KV_REST_API_TOKEN.",
        )
      : item("rate-limit", label, "ok", "In memory. Fine outside production.")
  return { id: "rate-limit", title: "Rate limits", items: [it] }
}

// ---- telegram ------------------------------------------------------------------

function telegramSection(t: StatusInputs["telegram"]): StatusSection {
  const token = t.token
    ? item("telegram-token", "Bot token", "ok", "Set.")
    : item(
        "telegram-token",
        "Bot token",
        "warning",
        "Not set (TELEGRAM_BOT_TOKEN). Nothing is sent to Telegram.",
      )
  const security = t.securityChat
    ? item("telegram-chat", "Security chat", "ok", "Set. Security reports are posted there.")
    : item(
        "telegram-chat",
        "Security chat",
        "warning",
        "Not set (TELEGRAM_CHAT_ID). Security reports are only stored in the database.",
      )
  const label = "Moderation chat"
  const needsToken = t.token ? "" : " Needs the bot token."
  const moderation =
    t.moderationChat === "off"
      ? item(
          "telegram-moderation",
          label,
          "warning",
          "Switched off (OFF). Moderators get no notices.",
        )
      : t.moderationChat === "none"
        ? item(
            "telegram-moderation",
            label,
            "warning",
            "No chat. Set TELEGRAM_MODERATION_CHAT_ID or TELEGRAM_CHAT_ID.",
          )
        : item(
            "telegram-moderation",
            label,
            t.token ? "ok" : "warning",
            (t.moderationChat === "own"
              ? "Own chat (TELEGRAM_MODERATION_CHAT_ID)."
              : "Uses the security chat (TELEGRAM_CHAT_ID).") + needsToken,
          )
  return { id: "telegram", title: "Telegram", items: [token, security, moderation] }
}

// ---- automatic checks ----------------------------------------------------------

const KIND_NAMES: Record<(typeof SCAN_KINDS)[number], string> = {
  images: "images",
  pdfs: "PDFs",
  proposals: "proposal text",
  comments: "comments",
}

function scanSection(s: StatusInputs["scan"]): StatusSection {
  const settings = s.settings
  const on = settings?.enabled ?? false
  const items: StatusItem[] = []

  items.push(
    s.apiKey
      ? item("scan-key", "API key", "ok", "Set.")
      : item(
          "scan-key",
          "API key",
          on ? "problem" : "warning",
          on
            ? "Checks are on, but ANTHROPIC_API_KEY isn't set. Nothing is checked."
            : "Not set (ANTHROPIC_API_KEY). Checks can't run.",
        ),
  )

  if (!settings) {
    items.push(
      item("scan-enabled", "Checks", "warning", "The settings can't be read, so checks are off."),
    )
  } else if (!on) {
    items.push(item("scan-enabled", "Checks", "warning", "Off. Nothing is checked automatically."))
  } else {
    const kinds = SCAN_KINDS.filter((k) => settings[k]).map((k) => KIND_NAMES[k])
    items.push(
      kinds.length
        ? item("scan-enabled", "Checks", "ok", `On for ${kinds.join(", ")}.`)
        : item("scan-enabled", "Checks", "warning", "On, but every kind is switched off."),
    )
  }

  if (settings) {
    const model = SCAN_MODELS[settings.model].label
    const saved = s.savedModel
    items.push(
      saved && !SCAN_MODEL_IDS.includes(saved as ScanModel)
        ? item(
            "scan-model",
            "Model",
            "warning",
            `The saved model (${saved}) is no longer offered; checks use ${model}. Save the settings to confirm.`,
          )
        : item("scan-model", "Model", "ok", `${model}, offered.`),
    )

    const n = s.checksToday
    const limit = settings.dailyLimit
    items.push(
      n == null
        ? item("scan-today", "Checks today", "warning", "Usage can't be read.")
        : on && n >= limit
          ? item(
              "scan-today",
              "Checks today",
              "warning",
              `Daily limit reached (${n} of ${limit}). Uploads wait for a moderator until 00:00 UTC.`,
            )
          : on && n >= limit * 0.8
            ? item(
                "scan-today",
                "Checks today",
                "warning",
                `${n} of ${limit}. Close to the daily limit.`,
              )
            : item("scan-today", "Checks today", "ok", `${n} of ${limit}.`),
    )
  }

  const h = s.health
  items.push(
    h == null
      ? item("scan-health", "Health", "warning", "The health record can't be read.")
      : h.state === "failing"
        ? item(
            "scan-health",
            "Health",
            "problem",
            `${h.problem} Since ${formatUtc(h.first_seen)}, last seen ${formatUtc(h.last_seen)}. Uploads are posted without a check.`,
          )
        : item("scan-health", "Health", "ok", "No setup problem recorded."),
  )
  return { id: "scan", title: "Automatic checks", items }
}

// ---- legal and wallet ----------------------------------------------------------

function legalSection(i: StatusInputs): StatusSection {
  const missing: StatusLevel = i.production ? "problem" : "warning"
  const l = i.legal
  return {
    id: "legal",
    title: "Legal pages",
    items: [
      l.name
        ? item("legal-name", "Operator name", "ok", "Set.")
        : item(
            "legal-name",
            "Operator name",
            missing,
            "Not set (LEGAL_OPERATOR_NAME). The pages name the site maintainer instead.",
          ),
      l.email === "set"
        ? item("legal-email", "Contact email", "ok", "Set.")
        : l.email === "invalid"
          ? item(
              "legal-email",
              "Contact email",
              missing,
              "LEGAL_CONTACT_EMAIL isn't an email address.",
            )
          : item(
              "legal-email",
              "Contact email",
              missing,
              "Not set (LEGAL_CONTACT_EMAIL). The pages show the default address from the code.",
            ),
      l.address
        ? item("legal-address", "Postal address", "ok", "Set.")
        : item(
            "legal-address",
            "Postal address",
            "ok",
            "Not set (optional). The pages offer it on request by email.",
          ),
    ],
  }
}

function walletSection(i: StatusInputs): StatusSection {
  const label = "WalletConnect project id"
  return {
    id: "wallet",
    title: "Wallets",
    items: [
      i.walletConnect
        ? item("walletconnect", label, "ok", "Set. Enjin Wallet and WalletConnect work.")
        : item(
            "walletconnect",
            label,
            i.production ? "problem" : "warning",
            "Not set (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID). Only browser-extension wallets work.",
          ),
    ],
  }
}

export function buildStatus(i: StatusInputs): StatusReport {
  const h = i.scan.health
  return {
    production: i.production,
    sections: [
      databaseSection(i.database),
      storageSection(i),
      rateLimitSection(i),
      telegramSection(i.telegram),
      scanSection(i.scan),
      legalSection(i),
      walletSection(i),
    ],
    health:
      h?.state === "failing"
        ? { problem: h.problem, first_seen: h.first_seen, last_seen: h.last_seen }
        : null,
    can_send_test:
      i.telegram.token &&
      (i.telegram.moderationChat === "own" || i.telegram.moderationChat === "security"),
  }
}

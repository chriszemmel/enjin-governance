/**
 * Moderation rules, kept pure so they can be tested and shared by the API
 * routes and the UI.
 *
 *   Proposer   removes their own attachments (file included).
 *   Moderator  keeps, blurs, hides or restores proposals, attachments and
 *              comments. Every action needs a public reason.
 *   Admin      everything a moderator can, plus deleting files (legal
 *              takedowns), pausing someone's posting and managing roles.
 *
 * Nobody can rewrite someone else's text, and nothing here touches
 * referenda, votes or on-chain data.
 */

export type ModerationRole = "moderator" | "admin"
export type ModerationTarget = "proposal" | "attachment" | "comment"
export type ModerationStateValue = "visible" | "blurred" | "hidden" | "removed"
export type ContentAction = "keep" | "blur" | "hide" | "restore" | "delete_file"

export const REPORT_CATEGORIES = [
  "personal_data",
  "scam",
  "sexual_violent",
  "harassment",
  "secrets",
  "illegal",
  "spam",
  "other",
] as const
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  personal_data: "Personal data",
  scam: "Scam or phishing",
  sexual_violent: "Sexual or violent",
  harassment: "Hate or abuse",
  secrets: "Seed phrase / key",
  illegal: "Illegal content",
  spam: "Spam",
  other: "Something else",
}

export function roleAtLeast(role: ModerationRole | null, min: ModerationRole): boolean {
  if (!role) return false
  return min === "moderator" || role === "admin"
}

/** Actions a role may take on a target type. */
export function allowedActions(
  target: ModerationTarget,
  role: ModerationRole | null,
): ContentAction[] {
  if (!roleAtLeast(role, "moderator")) return []
  const base: ContentAction[] =
    target === "attachment" ? ["keep", "blur", "hide", "restore"] : ["keep", "hide", "restore"]
  return target === "attachment" && role === "admin" ? [...base, "delete_file"] : base
}

export function stateAfter(action: ContentAction): ModerationStateValue {
  switch (action) {
    case "blur":
      return "blurred"
    case "hide":
      return "hidden"
    case "delete_file":
      return "removed"
    case "keep":
    case "restore":
      return "visible"
  }
}

/** "Keep visible" means the reports were unfounded. */
export function reportStatusAfter(action: ContentAction): "resolved" | "dismissed" {
  return action === "keep" ? "dismissed" : "resolved"
}

/**
 * Whether the public may load the bytes of an attachment. Hidden and
 * removed files never; an image the automatic check blurred waits for a
 * moderator (the blur alone is only an overlay in the page). A blur a
 * moderator chose is served, behind the tap-to-show cover.
 */
export function mediaServable(
  state: { state: ModerationStateValue; source?: string | null } | null | undefined,
): boolean {
  if (!state) return true
  if (state.state === "hidden" || state.state === "removed") return false
  return !(state.state === "blurred" && state.source === "automatic")
}

/**
 * The admin allowlist from GOVERNANCE_ADMIN_PUBLIC_KEYS: comma or space
 * separated SS58 addresses (any network) or 0x public keys. Entries that
 * don't decode are ignored.
 */
export function parseAdminKeys(
  raw: string | undefined,
  toPublicKey: (address: string) => string,
): Set<string> {
  const out = new Set<string>()
  for (const entry of (raw ?? "").split(/[\s,]+/)) {
    const v = entry.trim()
    if (!v) continue
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) {
      out.add(v.toLowerCase())
      continue
    }
    try {
      out.add(toPublicKey(v).toLowerCase())
    } catch {
      // not an address - skip
    }
  }
  return out
}

/** `proposals/<network>/<uuid>/media/<name>` → its network and proposal id. */
export function parseMediaKey(key: string): { network: string; proposalId: string } | null {
  const m = /^proposals\/([a-z-]+)\/([0-9a-f-]{36})\/media\/[^/]+$/.exec(key)
  return m ? { network: m[1]!, proposalId: m[2]! } : null
}

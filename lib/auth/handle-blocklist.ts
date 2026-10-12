/**
 * Username / display-name policy for the governance app.
 *
 * Two checks:
 *
 * - `validateHandle` runs on the `@handle` field. Handles are
 *   case-insensitive (CITEXT in Postgres), exclusively lowercase
 *   ASCII alphanumerics + underscore, 3-32 chars. Blocked against an
 *   exact-match reserved list (roles, project terms) and a profanity
 *   substring list.
 *
 * - `validateDisplayName` runs on the free-text display name. Blocked
 *   against substring matches of impersonation phrases ("Enjin
 *   Support", "Official Enjin", "Verified Account", …) and the same
 *   profanity list. Matching runs on a folded form (see `matchForm`), so
 *   look-alike spaces, invisible characters, full-width or styled letters
 *   and accents can't slip a phrase past it. Store the name through
 *   `normalizeDisplayName`, the text that was checked.
 *
 * The lists are deliberately curated rather than exhaustive - better
 * to miss a few edge cases than to false-positive a real user's name.
 * Treat this as a guard-rail against obvious abuse, not a guarantee
 * of polite usernames.
 */

// Exact-match reserved handles. Compared against the lowercased input.
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // Role / authority impersonation.
  "admin",
  "administrator",
  "root",
  "system",
  "sys",
  "mod",
  "mods",
  "moderator",
  "moderators",
  "official",
  "support",
  "help",
  "helpdesk",
  "staff",
  "team",
  "owner",
  "ceo",
  "founder",
  "security",
  "abuse",
  "verified",
  "verify",
  // Generic / placeholder.
  "anon",
  "anonymous",
  "bot",
  "claude",
  "ai",
  "gpt",
  "null",
  "undefined",
  "deleted",
  "test",
  "user",
  "me",
  "you",
  // Project / chain identity.
  "enjin",
  "enj",
  "enjincoin",
  "efinity",
  "jumpnet",
  "nftio",
  "nft",
  "governance",
  "gov",
  "treasury",
  "council",
  "opengov",
  "polkadot",
  "ksm",
  "kusama",
  "parity",
  "substrate",
  "relay",
  "relaychain",
  "matrixchain",
])

// Lowercased substrings that suggest the user is impersonating an
// official role. Display-name only; handles are exact-matched above.
const IMPERSONATION_PATTERNS: readonly string[] = [
  "enjin support",
  "enjin team",
  "enjin admin",
  "enjin official",
  "enjin staff",
  "official enjin",
  "support team",
  "admin team",
  "governance team",
  "treasury team",
  "polkadot team",
  "verified account",
  "official account",
]

// Curated profanity / slur substring list. Intentionally short -
// covers the worst, not every coarse word. Matched against the
// lowercased input.
const PROFANITY_PATTERNS: readonly string[] = [
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "kike",
  "tranny",
  "cunt",
  "whore",
  "slut",
  "rapist",
  "molest",
  "pedo",
  "nazi",
  "hitler",
]

type HandleError = "too_short" | "format" | "reserved" | "profane"
type DisplayNameError = "too_long" | "impersonation" | "profane"

export function validateHandle(input: string): HandleError | null {
  // We do NOT lowercase before format-checking - the client lowercases
  // on type (account page), so uppercase reaching the server signals
  // something upstream is off. Surface it as a format error instead of
  // silently canonicalising. Reserved + profanity matches happen against
  // the already-lowercase string the regex enforces.
  const v = input.trim()
  if (v.length < 3) return "too_short"
  if (!/^[a-z0-9_]{3,32}$/.test(v)) return "format"
  if (RESERVED_HANDLES.has(v)) return "reserved"
  if (PROFANITY_PATTERNS.some((p) => v.includes(p))) return "profane"
  return null
}

// Characters that render as nothing or reorder the text around them: zero
// width space, soft hyphen, word joiner and invisible operators, byte order
// mark, Mongolian vowel separator, and the bidi marks, embeddings,
// overrides and isolates. A name never needs them, and U+202E alone makes
// "troppuS nijnE" display as "Enjin Support". Zero-width (non-)joiners stay:
// Persian, Indic scripts and emoji sequences need them.
const INVISIBLE_CONTROLS = /[\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g

/**
 * The display name as it should be stored: invisible and direction-control
 * characters removed, every kind of space (no-break, ideographic, line
 * separator, tab, …) turned into a plain space, runs collapsed, trimmed.
 * The letters themselves are kept as typed.
 */
export function normalizeDisplayName(input: string): string {
  return input.replace(INVISIBLE_CONTROLS, "").replace(/\s+/gu, " ").trim()
}

/**
 * What the phrase lists are matched against: NFKC (full-width and styled
 * letters, ligatures and odd spaces become plain ones), every format
 * character dropped (joiners included), accents and variation selectors
 * stripped, lowercased, and each run of spaces or punctuation made one
 * space - so "Enjin\u00A0Support", "Ｅｎｊｉｎ Support", "Ënjin-Support"
 * and "Enjin \u200B Support" all read "enjin support".
 */
function matchForm(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

export function validateDisplayName(input: string): DisplayNameError | null {
  const name = normalizeDisplayName(input)
  if (name.length === 0) return null
  if (name.length > 80) return "too_long"
  const v = matchForm(name)
  if (IMPERSONATION_PATTERNS.some((p) => v.includes(p))) return "impersonation"
  if (PROFANITY_PATTERNS.some((p) => v.includes(p))) return "profane"
  return null
}

export function handleErrorMessage(err: HandleError): string {
  switch (err) {
    case "too_short":
      return "Handle must be at least 3 characters."
    case "format":
      return "Handles use lowercase letters, numbers, and underscores only (3-32 chars)."
    case "reserved":
      return "That handle is reserved. Pick something else."
    case "profane":
      return "That handle isn't allowed. Pick something else."
  }
}

export function displayNameErrorMessage(err: DisplayNameError): string {
  switch (err) {
    case "too_long":
      return "Display name must be 80 characters or fewer."
    case "impersonation":
      return "Display name can't impersonate Enjin staff, support, or governance roles."
    case "profane":
      return "That display name isn't allowed."
  }
}

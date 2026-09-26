// Shared helpers for the site-wide password gate. Used by both proxy.ts
// (Edge runtime) and app/api/unlock/route.ts (Node runtime) - Web Crypto
// is available in both.

export const SITE_ACCESS_COOKIE = "enjin-gov-access"
export const SITE_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

const encoder = new TextEncoder()

export async function expectedCookieValue(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(password))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  )
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

// Only a path on this site. Browsers treat a backslash like "/" and drop
// tabs and newlines, so "/<backslash>evil.example" or "/<tab>/evil.example"
// would lead to another site.
const UNSAFE_IN_PATH = /[\\\u0000-\u001f\u007f]/

export function sanitizeNext(raw: string | null | undefined): string {
  if (!raw) return "/"
  if (!raw.startsWith("/") || raw.startsWith("//") || UNSAFE_IN_PATH.test(raw)) return "/"
  if (raw.startsWith("/unlock")) return "/"
  // Belt and braces: whatever the browser makes of it stays on this origin.
  try {
    if (new URL(raw, "https://same.origin").origin !== "https://same.origin") return "/"
  } catch {
    return "/"
  }
  return raw
}

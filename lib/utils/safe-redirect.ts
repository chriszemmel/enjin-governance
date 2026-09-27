/**
 * Only same-origin paths are allowed as a post-sign-in redirect (`?next=`).
 * Rejects absolute URLs, protocol-relative `//host`, the `/\host` form
 * browsers also treat as protocol-relative, and control characters (URL
 * parsers drop tabs and newlines, which could turn `/\t/host` into `//host`).
 */
export function safeRedirectPath(next: string | null | undefined): string | null {
  if (!next) return null
  if (!next.startsWith("/") || next.startsWith("//")) return null
  if (next.includes("\\")) return null
  if (/[\u0000-\u001f\u007f]/.test(next)) return null
  return next
}

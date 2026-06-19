import { NextResponse, type NextRequest } from "next/server"

/**
 * Browser CSRF defense for state-changing API calls, enforced in the
 * middleware so every mutating route is covered in one place (including
 * future ones).
 *
 * A browser always attaches an `Origin` header to a cross-site
 * POST/PATCH/PUT/DELETE, and script can't forge it. If that header is present
 * and its host isn't this deployment's own host (or the configured app URL),
 * the request originated from a page we don't control - the signature of a
 * CSRF attempt - so we refuse it. Requests carrying neither `Origin` nor
 * `Referer` are allowed: a non-browser client (curl, server-to-server) can't
 * ride a victim's session cookie, so it isn't a CSRF vector.
 *
 * Safe methods (GET/HEAD/OPTIONS) and non-API paths are never checked.
 *
 * Returns a 403 `NextResponse` to short-circuit with, or null to continue.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function enforceSameOrigin(request: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(request.method)) return null
  if (!request.nextUrl.pathname.startsWith("/api/")) return null

  // Origin is the trustworthy signal; fall back to Referer for the rare
  // browser flow that omits Origin. Neither present => not browser-driven.
  const source = request.headers.get("origin") ?? request.headers.get("referer")
  if (!source) return null

  let sourceHost: string
  try {
    sourceHost = new URL(source).host
  } catch {
    return blocked()
  }
  return allowedHosts(request).has(sourceHost) ? null : blocked()
}

function allowedHosts(request: NextRequest): Set<string> {
  const hosts = new Set<string>()
  const host = request.headers.get("host")
  if (host) hosts.add(host)
  // Behind a proxy the public host arrives as x-forwarded-host.
  const forwarded = request.headers.get("x-forwarded-host")
  if (forwarded) hosts.add(forwarded)
  // Optional explicit allow: the configured canonical app URL.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      hosts.add(new URL(appUrl).host)
    } catch {
      // ignore a malformed configured URL
    }
  }
  return hosts
}

function blocked(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Cross-origin request blocked." },
    { status: 403 },
  )
}

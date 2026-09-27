import { NextResponse, type NextRequest } from "next/server"
import {
  SITE_ACCESS_COOKIE,
  expectedCookieValue,
  timingSafeEqual,
} from "@/lib/auth/site-password"
import { enforceSameOrigin } from "@/lib/auth/csrf"
import { NETWORK_HINT_HEADER, networkHint } from "@/lib/seo/network-hint"

/**
 * Paths that never belong in search results: the JSON API, the signed-in
 * tools, the moderation queue (not its public log), the password gate, the
 * proposal editor and uploaded files. robots.txt asks crawlers to stay out;
 * this header also covers the ones that arrive by a link anyway.
 */
function isPrivatePath(pathname: string): boolean {
  return (
    /^\/(api|account|create|moderation|unlock)(\/|$)/.test(pathname) ||
    /^\/proposals\/[^/]+\/edit(\/|$)/.test(pathname) ||
    pathname.startsWith("/r/")
  )
}

/**
 * Let the request through with the headers this site adds: noindex for
 * private paths (and for everything while the gate is on), and the
 * `?network=` hint the proposal layout needs, since layouts can't read the
 * query string. A client-sent hint header is always replaced.
 */
function pass(request: NextRequest, gated: boolean): NextResponse {
  const { pathname, searchParams } = request.nextUrl
  let response: NextResponse
  if (pathname.startsWith("/proposals/")) {
    const headers = new Headers(request.headers)
    const hint = networkHint(searchParams.get("network"))
    if (hint) headers.set(NETWORK_HINT_HEADER, hint)
    else headers.delete(NETWORK_HINT_HEADER)
    response = NextResponse.next({ request: { headers } })
  } else {
    response = NextResponse.next()
  }
  if (gated || isPrivatePath(pathname)) {
    response.headers.set("X-Robots-Tag", "noindex")
  }
  return response
}

/**
 * A path with a broken %-escape (e.g. `/%E0%A4%A`) can't be decoded. This
 * proxy runs before Next decodes the path; left alone, Next's router fails
 * on it later and answers 500. Say what it is instead: a bad request.
 */
function hasMalformedEscape(pathname: string): boolean {
  try {
    decodeURIComponent(pathname)
    return false
  } catch {
    return true
  }
}

/**
 * User-agent fragments for social-media link unfurlers. When one of
 * these scrapes the site, we let them through without the password
 * gate so they can read og:title / og:description / og:image off the
 * <head> - otherwise share previews collapse to "Enjin Governance"
 * with no image, which defeats the per-page OG work entirely.
 *
 * Crawlers can spoof user-agents, but OG metadata isn't sensitive
 * (it's literally generated to be public), so the bypass costs us
 * nothing on the worst case.
 */
const SOCIAL_CRAWLER_UA_FRAGMENTS = [
  "facebookexternalhit",
  "facebot",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "skypeuripreview",
  "pinterest",
  "redditbot",
  "applebot",
  "embedly",
  "vkshare",
  "w3c_validator",
  "iframely",
  "tumblr",
] as const

function isSocialCrawler(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent")?.toLowerCase() ?? ""
  if (!ua) return false
  return SOCIAL_CRAWLER_UA_FRAGMENTS.some((frag) => ua.includes(frag))
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // CSRF: reject cross-site state-changing API calls. Runs regardless of the
  // password gate so it protects the app in production too.
  const csrf = enforceSameOrigin(request)
  if (csrf) return csrf

  const { pathname, search } = request.nextUrl

  if (hasMalformedEscape(pathname)) {
    return new NextResponse("Bad Request", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  if (process.env.SITE_PASSWORD_STATUS !== "ON") {
    return pass(request, false)
  }

  // The gate page, its API, and the public brand assets it renders must
  // remain reachable while the rest of the site is locked.
  if (
    pathname === "/unlock" ||
    pathname === "/api/unlock" ||
    pathname.startsWith("/brand/") ||
    // Who runs the site and how data is handled must stay readable.
    pathname === "/imprint" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    // Crawlers must be able to read "disallow everything" and the empty
    // sitemap, and browsers the manifest. The matcher below already skips
    // these; listing them here keeps them open if the matcher changes.
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest"
  ) {
    return pass(request, true)
  }

  // Per-route OpenGraph images are public previews by design - Next
  // generates them as `/<route>/opengraph-image[-<hash>]` (the root
  // one is just `/opengraph-image`). Letting these through means
  // link unfurlers can render the actual PNG instead of falling back
  // to the password gate HTML.
  if (
    pathname === "/opengraph-image" ||
    pathname === "/twitter-image" ||
    pathname.endsWith("/opengraph-image") ||
    pathname.endsWith("/twitter-image") ||
    /\/opengraph-image-[a-z0-9]+/.test(pathname) ||
    /\/twitter-image-[a-z0-9]+/.test(pathname)
  ) {
    return pass(request, true)
  }

  // Social link-unfurlers fetch the page itself to read og:* meta
  // tags out of <head>. Without this bypass the unfurler sees the
  // /unlock HTML and parses no OG metadata at all. Scope the exemption
  // to non-API paths so a spoofed crawler UA can't reach the JSON APIs
  // (e.g. the proposal write endpoints) without the password gate.
  if (!pathname.startsWith("/api/") && isSocialCrawler(request)) {
    return pass(request, true)
  }

  const password = process.env.SITE_PASSWORD
  const cookie = request.cookies.get(SITE_ACCESS_COOKIE)?.value
  if (password && cookie) {
    const expected = await expectedCookieValue(password)
    if (timingSafeEqual(cookie, expected)) {
      return pass(request, true)
    }
  }

  const url = request.nextUrl.clone()
  url.pathname = "/unlock"
  url.search = `?next=${encodeURIComponent(pathname + search)}`
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest).*)",
  ],
}

import { NextResponse, type NextRequest } from "next/server"
import {
  SITE_ACCESS_COOKIE,
  expectedCookieValue,
  timingSafeEqual,
} from "@/lib/auth/site-password"
import { enforceSameOrigin } from "@/lib/auth/csrf"

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

  if (process.env.SITE_PASSWORD_STATUS !== "ON") {
    return NextResponse.next()
  }

  const { pathname, search } = request.nextUrl

  // The gate page, its API, and the public brand assets it renders must
  // remain reachable while the rest of the site is locked.
  if (
    pathname === "/unlock" ||
    pathname === "/api/unlock" ||
    pathname.startsWith("/brand/")
  ) {
    return NextResponse.next()
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
    return NextResponse.next()
  }

  // Social link-unfurlers fetch the page itself to read og:* meta
  // tags out of <head>. Without this bypass the unfurler sees the
  // /unlock HTML and parses no OG metadata at all. Scope the exemption
  // to non-API paths so a spoofed crawler UA can't reach the JSON APIs
  // (e.g. the proposal write endpoints) without the password gate.
  if (!pathname.startsWith("/api/") && isSocialCrawler(request)) {
    return NextResponse.next()
  }

  const password = process.env.SITE_PASSWORD
  const cookie = request.cookies.get(SITE_ACCESS_COOKIE)?.value
  if (password && cookie) {
    const expected = await expectedCookieValue(password)
    if (timingSafeEqual(cookie, expected)) {
      return NextResponse.next()
    }
  }

  const url = request.nextUrl.clone()
  url.pathname = "/unlock"
  url.search = `?next=${encodeURIComponent(pathname + search)}`
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|robots\\.txt|sitemap\\.xml).*)",
  ],
}

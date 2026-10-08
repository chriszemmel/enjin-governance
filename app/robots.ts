import type { MetadataRoute } from "next"
import { absoluteUrl, isSiteGated } from "@/lib/seo/site"

/**
 * /robots.txt. Read per request so it follows the password gate the same
 * way proxy.ts does. The proxy also sends `X-Robots-Tag: noindex` for the
 * same private areas, for crawlers that arrive by a link anyway.
 */

export const dynamic = "force-dynamic"

// Private or pointless in search results: the signed-in tools, the
// moderation queue, the password gate, the proposal editor and uploaded
// files (which moderators can withdraw). "/moderation" is a prefix of
// "/moderation-log", which the longer Allow rule keeps open.
const DISALLOW = [
  "/api/",
  "/account",
  "/create",
  "/moderation",
  "/unlock",
  "/proposals/*/edit",
  "/r/",
]

const ALLOW = [
  "/",
  "/moderation-log",
  // Link previews of any page, including the ones above.
  "/*/opengraph-image",
  "/og/referendum/",
  // Public reads the pages make while they render. Crawlers that run
  // JavaScript need them to see what a visitor sees (titles, text, votes,
  // names). The responses themselves carry noindex. Everything else under
  // /api/ stays disallowed, including routes added later.
  "/api/proposals/by-index/",
  "/api/proposals/by-indices",
  "/api/proposals/*/json",
  "/api/proposals/*/comments",
  "/api/subscan/",
  "/api/users/by-address",
  "/api/moderation/state",
  "/api/moderation/log",
]

export default function robots(): MetadataRoute.Robots {
  if (isSiteGated()) {
    return { rules: { userAgent: "*", disallow: "/" } }
  }
  return {
    rules: { userAgent: "*", allow: ALLOW, disallow: DISALLOW },
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}

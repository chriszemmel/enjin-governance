import type { MetadataRoute } from "next"
import { listPublicReferenda } from "@/lib/seo/referenda"
import { absoluteUrl, defaultChain, isSiteGated } from "@/lib/seo/site"

/**
 * /sitemap.xml - the public pages and one entry per referendum on the
 * default network. Other networks' referenda are reachable with
 * `?network=` but kept out of the index (see lib/seo/metadata.ts), so they
 * aren't listed. Rebuilt at most hourly; a database or chain outage only
 * shortens the list, it never fails the response.
 */

export const revalidate = 3600

type Entry = MetadataRoute.Sitemap[number]

// Google ignores changeFrequency and priority; other crawlers use them as hints.
const PAGES: Array<Pick<Entry, "changeFrequency" | "priority"> & { path: string }> = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/proposals", changeFrequency: "hourly", priority: 0.9 },
  { path: "/treasury", changeFrequency: "daily", priority: 0.8 },
  { path: "/docs", changeFrequency: "monthly", priority: 0.6 },
  { path: "/moderation-log", changeFrequency: "weekly", priority: 0.3 },
  { path: "/security", changeFrequency: "yearly", priority: 0.3 },
  { path: "/imprint", changeFrequency: "yearly", priority: 0.2 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // While the password gate is on, robots.txt disallows everything and
  // doesn't point here. The sitemap sits outside the gate, so it lists
  // nothing rather than the private site's URLs.
  if (isSiteGated()) return []

  const pages: MetadataRoute.Sitemap = PAGES.map(({ path, ...hints }) => ({
    url: absoluteUrl(path),
    ...hints,
  }))
  const referenda = await listPublicReferenda(defaultChain())
  return [
    ...pages,
    ...referenda.map(
      ({ index, lastModified }): Entry => ({
        url: absoluteUrl(`/proposals/${index}`),
        // Only a real date: when the published text or its flags last changed.
        ...(lastModified ? { lastModified } : {}),
        changeFrequency: "daily",
        priority: 0.7,
      }),
    ),
  ]
}

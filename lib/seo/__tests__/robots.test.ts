/**
 * app/robots.ts: what crawlers may fetch with the gate off, and nothing at
 * all with it on. Paths are checked with the RFC 9309 rules crawlers use
 * (longest matching rule wins, Allow on a tie, `*` wildcard, `$` end).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import robots from "@/app/robots"
import { siteUrl } from "@/lib/seo/site"

type Rules = { allow?: string | string[]; disallow?: string | string[] }

const list = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v])

function toRegExp(rule: string): RegExp {
  const anchored = rule.endsWith("$")
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp(`^${body}${anchored ? "$" : ""}`)
}

function mayFetch(rules: Rules, path: string): boolean {
  let best: { length: number; allow: boolean } = { length: -1, allow: true }
  for (const [allow, rule] of [
    ...list(rules.allow).map((r) => [true, r] as const),
    ...list(rules.disallow).map((r) => [false, r] as const),
  ]) {
    if (!toRegExp(rule).test(path)) continue
    if (rule.length > best.length || (rule.length === best.length && allow)) {
      best = { length: rule.length, allow }
    }
  }
  return best.allow
}

function rulesFor(result: ReturnType<typeof robots>): Rules {
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules]
  expect(rules).toHaveLength(1)
  expect(rules[0].userAgent).toBe("*")
  return rules[0]
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("robots.txt with the password gate off", () => {
  it("points to the sitemap on the configured origin", () => {
    vi.stubEnv("SITE_PASSWORD_STATUS", "OFF")
    expect(robots().sitemap).toBe(`${siteUrl()}/sitemap.xml`)
  })

  it("lets crawlers read the public pages, their previews and the reads they render from", () => {
    vi.stubEnv("SITE_PASSWORD_STATUS", "OFF")
    const rules = rulesFor(robots())
    for (const path of [
      "/",
      "/proposals",
      "/proposals/42",
      "/proposals/42?network=enjin-relay",
      "/treasury",
      "/docs",
      "/moderation-log",
      "/security",
      "/imprint",
      "/privacy",
      "/terms",
      "/user/enAbc",
      "/opengraph-image",
      "/create/opengraph-image",
      "/unlock/opengraph-image-a1b2c3",
      "/api/proposals/by-index/42?network=enjin-relay",
      "/api/proposals/by-indices",
      "/api/proposals/11111111-1111-4111-8111-111111111111/json",
      "/api/proposals/11111111-1111-4111-8111-111111111111/comments",
      "/api/subscan/enjin-relay/referendum/42",
      "/api/users/by-address/enAbc",
      "/api/users/by-addresses",
      "/api/moderation/state?proposal=x",
      "/api/moderation/log",
      "/_next/static/chunks/app.js",
    ]) {
      expect(mayFetch(rules, path), path).toBe(true)
    }
  })

  it("keeps crawlers out of the API, signed-in tools, moderation queue, gate, editor and uploads", () => {
    vi.stubEnv("SITE_PASSWORD_STATUS", "OFF")
    const rules = rulesFor(robots())
    for (const path of [
      "/api/auth/me",
      "/api/unlock",
      "/api/proposals/draft",
      "/api/moderation/queue",
      "/api/security-disclosures",
      "/account",
      "/account?tab=drafts",
      "/create",
      "/create/advanced",
      "/moderation",
      "/moderation?tab=settings",
      "/unlock",
      "/unlock?next=%2Fproposals",
      "/proposals/42/edit",
      "/proposals/42/edit?network=enjin-relay",
      "/r/proposals/enjin-relay/x/media/a.png",
    ]) {
      expect(mayFetch(rules, path), path).toBe(false)
    }
  })
})

describe("robots.txt with the password gate on", () => {
  it("disallows everything and doesn't advertise the sitemap", () => {
    vi.stubEnv("SITE_PASSWORD_STATUS", "ON")
    const result = robots()
    const rules = rulesFor(result)
    expect(result.sitemap).toBeUndefined()
    expect(list(rules.allow)).toEqual([])
    for (const path of ["/", "/proposals/42", "/imprint", "/opengraph-image", "/robots.txt"]) {
      expect(mayFetch(rules, path), path).toBe(false)
    }
  })
})

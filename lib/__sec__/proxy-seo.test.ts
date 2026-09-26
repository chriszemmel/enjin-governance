/**
 * What proxy.ts adds for crawlers and around the password gate: robots.txt,
 * the sitemap and the manifest stay reachable, private areas answer with
 * noindex, a path with a broken %-escape gets a 400 instead of Next's 500,
 * and the proposal layout gets the `?network=` hint. The real proxy runs;
 * nothing here does I/O.
 */
import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { SITE_ACCESS_COOKIE } from "@/lib/auth/site-password"
import { NETWORK_HINT_HEADER } from "@/lib/seo/network-hint"
import { config, proxy } from "@/proxy"

const PASSWORD = "correct horse battery staple"
const cookieFor = (password: string) => createHash("sha256").update(password).digest("hex")

function req(
  path: string,
  init: { method?: string; headers?: Record<string, string>; cookie?: string } = {},
) {
  const headers: Record<string, string> = { host: "gov.test", ...init.headers }
  if (init.cookie !== undefined) headers.cookie = `${SITE_ACCESS_COOKIE}=${init.cookie}`
  return new NextRequest(`https://gov.test${path}`, { method: init.method ?? "GET", headers })
}
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1"
const noindex = (res: Response) => res.headers.get("x-robots-tag") === "noindex"
/** The request headers the proxy hands on to the page, if it changed any. */
const forwarded = (res: Response, name: string) =>
  res.headers.get("x-middleware-override-headers")?.split(",").includes(name)
    ? res.headers.get(`x-middleware-request-${name}`)
    : undefined

beforeEach(() => {
  vi.stubEnv("SITE_PASSWORD_STATUS", "OFF")
  vi.stubEnv("SITE_PASSWORD", PASSWORD)
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("robots.txt, sitemap.xml and the manifest", () => {
  it("get through the password gate without a cookie", async () => {
    vi.stubEnv("SITE_PASSWORD_STATUS", "ON")
    for (const path of ["/robots.txt", "/sitemap.xml", "/manifest.webmanifest"]) {
      const res = await proxy(req(path))
      expect(passes(res), path).toBe(true)
    }
    // Look-alikes are still gated.
    for (const path of ["/robots.txt/x", "/sitemap.xml.bak", "/api/robots.txt"]) {
      expect((await proxy(req(path))).status, path).toBe(307)
    }
  })

  it("don't even reach the proxy in production: the matcher skips them", () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url })
    for (const url of ["/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/favicon.svg"]) {
      expect(matches(url), url).toBe(false)
    }
    for (const url of ["/", "/proposals/5", "/api/auth/me", "/unlock", "/%E0%A4%A"]) {
      expect(matches(url), url).toBe(true)
    }
  })
})

describe("X-Robots-Tag", () => {
  it("marks private areas noindex and leaves public pages alone", async () => {
    for (const path of [
      "/api/auth/me",
      "/api/proposals/by-index/5",
      "/account",
      "/account/settings",
      "/create",
      "/create/advanced",
      "/moderation",
      "/unlock",
      "/proposals/5/edit",
      "/r/proposals/enjin-relay/x/media/a.png",
    ]) {
      expect(noindex(await proxy(req(path))), path).toBe(true)
    }
    for (const path of [
      "/",
      "/proposals",
      "/proposals/5",
      "/treasury",
      "/moderation-log",
      "/security",
      "/user/enAbc",
      "/imprint",
      "/accounts-explained",
      "/creators",
      "/proposals/5/editor",
    ]) {
      const res = await proxy(req(path))
      expect(passes(res), path).toBe(true)
      expect(noindex(res), path).toBe(false)
    }
  })

  it("marks everything noindex while the gate is on, for whoever gets through", async () => {
    vi.stubEnv("SITE_PASSWORD_STATUS", "ON")
    const ua = { "user-agent": "Mozilla/5.0 (compatible; Applebot/0.1)" }
    for (const res of [
      await proxy(req("/proposals/5", { cookie: cookieFor(PASSWORD) })),
      await proxy(req("/proposals/5", { headers: ua })),
      await proxy(req("/imprint")),
      await proxy(req("/opengraph-image")),
    ]) {
      expect(passes(res)).toBe(true)
      expect(noindex(res)).toBe(true)
    }
  })
})

describe("a path with a malformed %-escape", () => {
  it("gets a plain 400, with the gate on or off", async () => {
    for (const status of ["OFF", "ON"]) {
      vi.stubEnv("SITE_PASSWORD_STATUS", status)
      for (const path of ["/%E0%A4%A", "/proposals/%ZZ", "/user/%", "/api/users/by-address/%FF"]) {
        const res = await proxy(req(path))
        expect(res.status, `${status} ${path}`).toBe(400)
        expect(res.headers.get("content-type")).toMatch(/^text\/plain/)
        expect(await res.text()).toBe("Bad Request")
      }
    }
    // Well-formed escapes are fine.
    vi.stubEnv("SITE_PASSWORD_STATUS", "OFF")
    expect(passes(await proxy(req("/user/%C3%A9t%C3%A9")))).toBe(true)
  })

  it("is still checked after CSRF, which answers first", async () => {
    const res = await proxy(
      req("/api/%E0%A4%A", { method: "POST", headers: { origin: "https://evil.example" } }),
    )
    expect(res.status).toBe(403)
  })
})

describe("the ?network= hint for the proposal layout", () => {
  it("copies a plausible network id into the request header", async () => {
    const res = await proxy(req("/proposals/5?network=enjin-relay"))
    expect(passes(res)).toBe(true)
    expect(forwarded(res, NETWORK_HINT_HEADER)).toBe("enjin-relay")
  })

  it("never passes on a hint the client sent itself or a junk value", async () => {
    const spoofed = { [NETWORK_HINT_HEADER]: "canary-relay" }
    for (const path of [
      "/proposals/5",
      "/proposals/5?network=%3Cscript%3E",
      "/proposals/5?network=",
    ]) {
      const res = await proxy(req(path, { headers: spoofed }))
      expect(passes(res), path).toBe(true)
      expect(forwarded(res, NETWORK_HINT_HEADER), path).toBeUndefined()
      // The header list the page receives no longer has it.
      expect(res.headers.get("x-middleware-override-headers")?.split(",")).not.toContain(
        NETWORK_HINT_HEADER,
      )
    }
  })

  it("sets it behind the gate too, once the visitor is let through", async () => {
    vi.stubEnv("SITE_PASSWORD_STATUS", "ON")
    const res = await proxy(
      req("/proposals/5?network=enjin-relay", { cookie: cookieFor(PASSWORD) }),
    )
    expect(forwarded(res, NETWORK_HINT_HEADER)).toBe("enjin-relay")
    // Without the cookie it's still a redirect to the gate.
    expect((await proxy(req("/proposals/5?network=enjin-relay"))).status).toBe(307)
  })
})

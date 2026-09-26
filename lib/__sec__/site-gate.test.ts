/**
 * The site-wide password gate: POST /api/unlock and the gate in proxy.ts.
 * The real route handler, the real proxy function, the real site-password
 * helpers and the real in-process rate limiter run; nothing here does I/O.
 */
import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type * as RateLimit from "@/lib/rate-limit"

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof RateLimit>()
  return { ...real, enforceRateLimit: vi.fn(real.enforceRateLimit) }
})

import { __resetRateLimitStore, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { SITE_ACCESS_COOKIE, SITE_ACCESS_MAX_AGE_SECONDS } from "@/lib/auth/site-password"
import { POST as UNLOCK } from "@/app/api/unlock/route"
import { proxy } from "@/proxy"

const PASSWORD = "correct horse battery staple"
const IP = "203.0.113.9"
const cookieFor = (password: string) => createHash("sha256").update(password).digest("hex")

function unlock(body: unknown, ip = IP) {
  return UNLOCK(
    new NextRequest("https://gov.test/api/unlock", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  )
}

function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
}

beforeEach(() => {
  vi.stubEnv("SITE_PASSWORD_STATUS", "ON")
  vi.stubEnv("SITE_PASSWORD", PASSWORD)
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
  for (const k of [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]) {
    vi.stubEnv(k, "")
  }
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in tests")
  })
  __resetRateLimitStore()
  vi.mocked(enforceRateLimit).mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("POST /api/unlock", () => {
  it("does not exist while the gate is off", async () => {
    vi.stubEnv("SITE_PASSWORD_STATUS", "OFF")
    const res = await unlock({ password: PASSWORD })
    expect(res.status).toBe(404)
    expect(setCookie(res, SITE_ACCESS_COOKIE)).toBeUndefined()
  })

  it("fails closed when the gate is on but no password is configured", async () => {
    vi.stubEnv("SITE_PASSWORD", "")
    for (const password of ["", "anything"]) {
      const res = await unlock({ password })
      expect(res.status).toBe(503)
      expect(setCookie(res, SITE_ACCESS_COOKIE)).toBeUndefined()
    }
  })

  it("refuses a wrong, empty or non-string password without setting a cookie", async () => {
    const guesses = [
      "wrong",
      PASSWORD.toUpperCase(),
      `${PASSWORD} `,
      PASSWORD.slice(0, -1),
      "",
      undefined,
      null,
      123,
      [PASSWORD],
      { toString: PASSWORD },
    ]
    // One client per guess so the attempt cap (tested below) doesn't kick in.
    for (const [i, password] of guesses.entries()) {
      const res = await unlock({ password }, `198.51.100.${i}`)
      expect(res.status, JSON.stringify(password)).toBe(401)
      expect(setCookie(res, SITE_ACCESS_COOKIE)).toBeUndefined()
    }
    expect((await unlock("{nope")).status).toBe(400)
  })

  it("the right password sets an HttpOnly access cookie that is a digest, not the password", async () => {
    const res = await unlock({ password: PASSWORD, next: "/proposals/5?tab=votes" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, next: "/proposals/5?tab=votes" })

    const line = setCookie(res, SITE_ACCESS_COOKIE)!
    expect(line).toBeDefined()
    expect(line).toContain(`${SITE_ACCESS_COOKIE}=${cookieFor(PASSWORD)};`)
    expect(line).not.toContain(encodeURIComponent(PASSWORD))
    expect(line).toMatch(/;\s*HttpOnly/i)
    expect(line).toMatch(/;\s*SameSite=lax/i)
    expect(line).toMatch(/;\s*Path=\/(;|$)/)
    expect(line).toMatch(new RegExp(`;\\s*Max-Age=${SITE_ACCESS_MAX_AGE_SECONDS}(;|$)`))
    expect(line).not.toMatch(/;\s*Secure/i)
  })

  it("marks the access cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const res = await unlock({ password: PASSWORD })
    expect(setCookie(res, SITE_ACCESS_COOKIE)).toMatch(/;\s*Secure/i)
  })

  it("only ever sends the caller back to a same-site path", async () => {
    const cases: Array<[unknown, string]> = [
      ["/proposals", "/proposals"],
      ["//evil.example/x", "/"],
      ["https://evil.example/", "/"],
      ["javascript:alert(1)", "/"],
      ["evil.example", "/"],
      ["/unlock?next=//evil.example", "/"],
      ["", "/"],
      [42, "/"],
      [undefined, "/"],
    ]
    for (const [next, expected] of cases) {
      const res = await unlock({ password: PASSWORD, next })
      expect((await res.json()).next, JSON.stringify(next)).toBe(expected)
    }
  })

  // Browsers (and Next's router.replace in app/unlock/page.tsx) resolve
  // "/\evil.example" and "/<TAB>/evil.example" to https://evil.example/.
  it("refuses backslash and tab/newline variants of a protocol-relative next", async () => {
    for (const next of [
      "/\\evil.example",
      "/\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r//evil.example",
    ]) {
      const res = await unlock({ password: PASSWORD, next })
      expect((await res.json()).next, JSON.stringify(next)).toBe("/")
    }
    const plain = await unlock({ password: PASSWORD, next: "/proposals?q=tooling fund" })
    expect((await plain.json()).next).toBe("/proposals?q=tooling fund")
  })

  it("caps guesses per IP: after 10 attempts even the right password gets 429", async () => {
    for (let i = 0; i < RATE_LIMITS.siteUnlock.limit; i += 1) {
      expect((await unlock({ password: `guess-${i}` })).status).toBe(401)
    }
    const blocked = await unlock({ password: PASSWORD })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(setCookie(blocked, SITE_ACCESS_COOKIE)).toBeUndefined()
    expect(vi.mocked(enforceRateLimit).mock.calls[0][0]).toEqual({
      ...RATE_LIMITS.siteUnlock,
      identity: IP,
    })
    // Another client still gets in.
    expect((await unlock({ password: PASSWORD }, "198.51.100.4")).status).toBe(200)
  })
})

describe("proxy() password gate", () => {
  function req(
    path: string,
    init: { method?: string; headers?: Record<string, string>; cookie?: string } = {},
  ) {
    const headers: Record<string, string> = { host: "gov.test", ...init.headers }
    if (init.cookie !== undefined) headers.cookie = `${SITE_ACCESS_COOKIE}=${init.cookie}`
    return new NextRequest(`https://gov.test${path}`, { method: init.method ?? "GET", headers })
  }
  const passes = (res: Response) => res.headers.get("x-middleware-next") === "1"
  const redirectTarget = (res: Response) => {
    const loc = res.headers.get("location")
    return loc ? new URL(loc) : null
  }

  it("redirects a visitor without the cookie to /unlock, keeping where they were going", async () => {
    const res = await proxy(req("/proposals/5?tab=votes"))
    expect(res.status).toBe(307)
    const to = redirectTarget(res)!
    expect(to.origin).toBe("https://gov.test")
    expect(to.pathname).toBe("/unlock")
    expect(to.searchParams.get("next")).toBe("/proposals/5?tab=votes")
  })

  it("lets the right cookie through and redirects a wrong or stale one", async () => {
    expect(passes(await proxy(req("/proposals", { cookie: cookieFor(PASSWORD) })))).toBe(true)
    for (const cookie of [
      "",
      "garbage",
      PASSWORD,
      cookieFor("old password"),
      cookieFor(PASSWORD).toUpperCase(),
      `${cookieFor(PASSWORD)}0`,
    ]) {
      const res = await proxy(req("/proposals", { cookie }))
      expect(res.status, cookie).toBe(307)
    }
  })

  it("gates the JSON API too, and a cookie can't be forged without a configured password", async () => {
    const res = await proxy(req("/api/proposals/by-proposer?address=x"))
    expect(res.status).toBe(307)
    expect(redirectTarget(res)!.pathname).toBe("/unlock")

    vi.stubEnv("SITE_PASSWORD", "")
    // sha256("") would be the digest of an unset password.
    expect((await proxy(req("/proposals", { cookie: cookieFor("") }))).status).toBe(307)
  })

  it("leaves the gate page, its API, brand assets and the legal pages reachable", async () => {
    for (const path of [
      "/unlock",
      "/api/unlock",
      "/brand/logo.svg",
      "/imprint",
      "/privacy",
      "/terms",
      "/opengraph-image",
      "/proposals/5/opengraph-image",
      "/proposals/5/opengraph-image-a1b2c3",
      "/twitter-image",
    ]) {
      expect(passes(await proxy(req(path))), path).toBe(true)
    }
  })

  it("does not let look-alike or dot-segment paths ride the exemptions", async () => {
    for (const path of [
      "/unlocked",
      "/unlock/../proposals",
      "/api/unlock/../proposals/draft",
      "/brand/../api/proposals/draft",
      "/brandx/logo.svg",
      "/privacy-policy",
      "/api/unlockx",
    ]) {
      const res = await proxy(req(path))
      expect(res.status, path).toBe(307)
    }
  })

  it("lets social unfurlers read pages but never the API", async () => {
    const ua = { "user-agent": "Mozilla/5.0 (compatible; Twitterbot/1.0)" }
    expect(passes(await proxy(req("/proposals/5", { headers: ua })))).toBe(true)
    for (const path of ["/api/proposals/by-proposer", "/api/auth/me", "/api/moderation/queue"]) {
      expect((await proxy(req(path, { headers: ua }))).status, path).toBe(307)
    }
  })

  it("rejects a cross-site API write before the gate, with the gate on or off", async () => {
    const evil = { origin: "https://evil.example" }
    const res = await proxy(
      req("/api/unlock", { method: "POST", headers: evil, cookie: cookieFor(PASSWORD) }),
    )
    expect(res.status).toBe(403)

    vi.stubEnv("SITE_PASSWORD_STATUS", "OFF")
    expect((await proxy(req("/api/auth/logout", { method: "POST", headers: evil }))).status).toBe(
      403,
    )
    // Same-origin writes and plain page views pass when the gate is off.
    const same = { origin: "https://gov.test" }
    expect(passes(await proxy(req("/api/auth/logout", { method: "POST", headers: same })))).toBe(
      true,
    )
    expect(passes(await proxy(req("/proposals")))).toBe(true)
  })
})

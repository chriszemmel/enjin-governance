import { afterEach, describe, expect, it, vi } from "vitest"
import {
  consume,
  enforceRateLimit,
  ipFromHeaders,
  sweepExpired,
  __resetRateLimitStore,
  type RateLimitBucket,
} from "@/lib/rate-limit"

describe("consume (pure fixed-window core)", () => {
  it("allows the first request and seeds the window", () => {
    const store = new Map<string, RateLimitBucket>()
    const r = consume(store, "k", 3, 1000, 0)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(2)
    expect(r.resetAt).toBe(1000)
    expect(r.retryAfterSeconds).toBe(0)
  })

  it("counts down within the window", () => {
    const store = new Map<string, RateLimitBucket>()
    expect(consume(store, "k", 3, 1000, 0).remaining).toBe(2)
    expect(consume(store, "k", 3, 1000, 100).remaining).toBe(1)
    expect(consume(store, "k", 3, 1000, 200).remaining).toBe(0)
  })

  it("blocks the request that exceeds the limit and reports retry-after", () => {
    const store = new Map<string, RateLimitBucket>()
    consume(store, "k", 2, 1000, 0)
    consume(store, "k", 2, 1000, 100)
    const blocked = consume(store, "k", 2, 1000, 600)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.resetAt).toBe(1000)
    // ceil((1000 - 600) / 1000) = 1
    expect(blocked.retryAfterSeconds).toBe(1)
  })

  it("opens a fresh window once the old one elapses", () => {
    const store = new Map<string, RateLimitBucket>()
    consume(store, "k", 1, 1000, 0)
    expect(consume(store, "k", 1, 1000, 500).allowed).toBe(false)
    const next = consume(store, "k", 1, 1000, 1000)
    expect(next.allowed).toBe(true)
    expect(next.resetAt).toBe(2000)
  })

  it("isolates distinct keys", () => {
    const store = new Map<string, RateLimitBucket>()
    consume(store, "a", 1, 1000, 0)
    expect(consume(store, "a", 1, 1000, 10).allowed).toBe(false)
    expect(consume(store, "b", 1, 1000, 10).allowed).toBe(true)
  })

  it("never reports retryAfterSeconds below 1 when blocked", () => {
    const store = new Map<string, RateLimitBucket>()
    consume(store, "k", 1, 1000, 0)
    // 999ms in: 1ms left -> ceil(1/1000)=1, floored to 1 by Math.max.
    expect(consume(store, "k", 1, 1000, 999).retryAfterSeconds).toBe(1)
  })
})

describe("sweepExpired", () => {
  it("drops only buckets whose window has elapsed", () => {
    const store = new Map<string, RateLimitBucket>([
      ["old", { count: 5, resetAt: 500 }],
      ["live", { count: 1, resetAt: 2000 }],
    ])
    sweepExpired(store, 1000)
    expect(store.has("old")).toBe(false)
    expect(store.has("live")).toBe(true)
  })
})

describe("ipFromHeaders", () => {
  it("prefers the first x-forwarded-for hop", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })
    expect(ipFromHeaders(h)).toBe("1.2.3.4")
  })

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "9.9.9.9" })
    expect(ipFromHeaders(h)).toBe("9.9.9.9")
  })

  it("returns 'unknown' when no client IP header is present", () => {
    expect(ipFromHeaders(new Headers())).toBe("unknown")
  })
})

describe("enforceRateLimit (in-process fallback, no KV configured)", () => {
  afterEach(() => __resetRateLimitStore())

  it("blocks once the configured limit is reached", async () => {
    const args = { scope: "test", identity: "user-1", limit: 2, windowMs: 60_000 }
    expect((await enforceRateLimit(args)).allowed).toBe(true)
    expect((await enforceRateLimit(args)).allowed).toBe(true)
    expect((await enforceRateLimit(args)).allowed).toBe(false)
  })

  it("namespaces by scope + identity", async () => {
    expect(
      (await enforceRateLimit({ scope: "a", identity: "x", limit: 1, windowMs: 60_000 })).allowed,
    ).toBe(true)
    expect(
      (await enforceRateLimit({ scope: "a", identity: "x", limit: 1, windowMs: 60_000 })).allowed,
    ).toBe(false)
    // Different identity is a different bucket.
    expect(
      (await enforceRateLimit({ scope: "a", identity: "y", limit: 1, windowMs: 60_000 })).allowed,
    ).toBe(true)
  })
})

describe("enforceRateLimit (Upstash KV backend)", () => {
  afterEach(() => {
    __resetRateLimitStore()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function stubKv(pipelineResult: Array<{ result?: unknown }>) {
    vi.stubEnv("KV_REST_API_URL", "https://kv.example")
    vi.stubEnv("KV_REST_API_TOKEN", "tok")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(pipelineResult), { status: 200 })),
    )
  }

  it("allows when the KV count is within the limit", async () => {
    // [SET, INCR -> 1, PTTL -> 59000ms]
    stubKv([{ result: "OK" }, { result: 1 }, { result: 59_000 }])
    const r = await enforceRateLimit({ scope: "s", identity: "i", limit: 5, windowMs: 60_000 })
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4)
  })

  it("blocks when the KV count exceeds the limit and reports retry-after", async () => {
    stubKv([{ result: null }, { result: 6 }, { result: 12_000 }])
    const r = await enforceRateLimit({ scope: "s", identity: "i", limit: 5, windowMs: 60_000 })
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSeconds).toBe(12)
  })

  it("falls back to the in-process store when KV errors (never fails open)", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://kv.example")
    vi.stubEnv("KV_REST_API_TOKEN", "tok")
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network") }))
    const args = { scope: "fb", identity: "i", limit: 1, windowMs: 60_000 }
    expect((await enforceRateLimit(args)).allowed).toBe(true)
    expect((await enforceRateLimit(args)).allowed).toBe(false)
  })
})

/**
 * Wallet sign-in routes: nonce issue, signature verify, session lookup and
 * logout. The REAL route handlers, the real SIWE crypto (a throwaway sr25519
 * key signs the real message), the real session resolution
 * (lib/auth/current-user) and the real in-process rate limiter run. Only I/O
 * is faked: the nonce / session / user tables, and the request cookie jar.
 */
import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type * as RateLimit from "@/lib/rate-limit"
import {
  cryptoWaitReady,
  decodeAddress,
  encodeAddress,
  randomAsU8a,
  sr25519PairFromSeed,
  sr25519Sign,
} from "@polkadot/util-crypto"
import { stringToU8a, u8aToHex } from "@polkadot/util"

type Row = {
  id: string
  address: string
  network: string | null
  handle: string | null
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  avatar_key: string | null
  avatar_updated_at: Date | null
  created_at: Date
  updated_at: Date
}

const io = vi.hoisted(() => ({
  dbConfigured: true,
  nonces: new Map<string, { address: string; message: string; expiresAt: Date }>(),
  gcCalls: 0,
  failInsertNonce: null as Error | null,
  sessions: new Map<
    string,
    {
      userId: string
      address: string
      expiresAt: Date
      userAgent: string | null
      ipAddress: string | null
    }
  >(),
  failDeleteSession: false,
  users: new Map<string, Row>(),
  /** The request's cookie jar, as next/headers would expose it. */
  jar: new Map<string, string>(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (io.jar.has(name) ? { name, value: io.jar.get(name) } : undefined),
  }),
}))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => io.dbConfigured,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
// Same semantics as the SQL: consume is DELETE ... WHERE nonce AND address
// AND expires_at > NOW() RETURNING message, so a row is usable exactly once.
vi.mock("@/lib/db/auth-nonces", () => ({
  insertNonce: async (a: { nonce: string; address: string; message: string; expiresAt: Date }) => {
    if (io.failInsertNonce) throw io.failInsertNonce
    io.nonces.set(a.nonce, { address: a.address, message: a.message, expiresAt: a.expiresAt })
  },
  consumeNonceRow: async (a: { nonce: string; address: string }) => {
    const row = io.nonces.get(a.nonce)
    if (!row || row.address !== a.address || row.expiresAt.getTime() <= Date.now()) return null
    io.nonces.delete(a.nonce)
    return { message: row.message }
  },
  gcExpiredNonces: async () => {
    io.gcCalls += 1
  },
}))
vi.mock("@/lib/db/sessions", () => ({
  insertSession: async (s: {
    tokenHash: string
    userId: string
    address: string
    expiresAt: Date
    userAgent: string | null
    ipAddress: string | null
  }) => {
    const { tokenHash, ...rest } = s
    io.sessions.set(tokenHash, rest)
  },
  getActiveSession: async (tokenHash: string) => {
    const s = io.sessions.get(tokenHash)
    if (!s || s.expiresAt.getTime() <= Date.now()) return null
    return { token_hash: tokenHash, user_id: s.userId, address: s.address }
  },
  deleteSession: async (tokenHash: string) => {
    if (io.failDeleteSession) throw new Error("db down")
    io.sessions.delete(tokenHash)
  },
}))
vi.mock("@/lib/db/users", () => ({
  upsertUserByAddress: async (address: string) => {
    const existing = io.users.get(address)
    if (existing) return existing
    const row: Row = {
      id: `user-${io.users.size + 1}`,
      address,
      network: "enjin-relay",
      handle: null,
      display_name: null,
      bio: null,
      avatar_url: null,
      avatar_key: "user-avatars/secret-key.png",
      avatar_updated_at: null,
      created_at: new Date(0),
      updated_at: new Date(0),
    }
    io.users.set(address, row)
    return row
  },
  getUserByAddress: async (address: string) => io.users.get(address) ?? null,
}))
// The real limiter (in-process store), wrapped so tests can see its inputs.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof RateLimit>()
  return { ...real, enforceRateLimit: vi.fn(real.enforceRateLimit) }
})

import { __resetRateLimitStore, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { NONCE_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/siwe"
import { POST as NONCE } from "@/app/api/auth/nonce/route"
import { POST as VERIFY } from "@/app/api/auth/verify/route"
import { GET as ME } from "@/app/api/auth/me/route"
import { POST as LOGOUT } from "@/app/api/auth/logout/route"

const IP = "203.0.113.7"
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

type Wallet = { address: string; sign: (message: string) => string }

/** A throwaway sr25519 key that signs like the polkadot-js extension. */
async function wallet(prefix = 2135): Promise<Wallet> {
  await cryptoWaitReady()
  const pair = sr25519PairFromSeed(randomAsU8a(32))
  return {
    address: encodeAddress(pair.publicKey, prefix),
    sign: (message) => u8aToHex(sr25519Sign(stringToU8a(`<Bytes>${message}</Bytes>`), pair)),
  }
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://gov.test${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `${IP}, 10.0.0.1`,
      "user-agent": "vitest-wallet",
      ...headers,
    },
  })
}
const nonceReq = (address: unknown, headers?: Record<string, string>) =>
  NONCE(post("/api/auth/nonce", { address }, headers))
const verifyReq = (body: unknown, headers?: Record<string, string>) =>
  VERIFY(post("/api/auth/verify", body, headers))

async function issue(w: Wallet): Promise<{ nonce: string; message: string }> {
  const res = await nonceReq(w.address)
  expect(res.status).toBe(200)
  return (await res.json()) as { nonce: string; message: string }
}

/** The Set-Cookie line for one cookie. */
function setCookie(res: Response, name: string): string {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
  if (!line) throw new Error(`no Set-Cookie for ${name}`)
  return line
}
const cookieValue = (line: string) => line.slice(line.indexOf("=") + 1, line.indexOf(";"))

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  io.dbConfigured = true
  io.nonces.clear()
  io.gcCalls = 0
  io.failInsertNonce = null
  io.sessions.clear()
  io.failDeleteSession = false
  io.users.clear()
  io.jar.clear()
  __resetRateLimitStore()
  vi.mocked(enforceRateLimit).mockClear()
  // No shared KV store in tests: the limiter must stay in-process and offline.
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
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  warn.mockRestore()
})

describe("POST /api/auth/nonce", () => {
  it("issues a single 32-hex nonce bound to the address, the stored message and a 30 min expiry", async () => {
    const w = await wallet()
    const before = Date.now()
    const { nonce, message } = await issue(w)

    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(message).toContain(`Address: ${w.address}`)
    expect(message).toContain(`Nonce: ${nonce}`)
    const row = io.nonces.get(nonce)!
    expect(row.address).toBe(w.address)
    // The wallet signs exactly the bytes the server stored.
    expect(row.message).toBe(message)
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(NONCE_TTL_MS)
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(NONCE_TTL_MS)
    expect(io.gcCalls).toBe(1)
  })

  it("refuses anything that is not a valid SS58 address, and oversized input", async () => {
    for (const address of [
      "not-an-address",
      "0xdeadbeef",
      // A real address with its checksum broken.
      "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iB",
      // A 32-byte public key in hex is not an SS58 address (and too long).
      `0x${"ab".repeat(32)}`,
      "e".repeat(65),
      "",
      42,
      null,
    ]) {
      const res = await nonceReq(address)
      expect(res.status, String(address)).toBe(400)
    }
    expect((await NONCE(post("/api/auth/nonce", "{not json"))).status).toBe(400)
    expect((await NONCE(post("/api/auth/nonce", {}))).status).toBe(400)
    expect(io.nonces.size).toBe(0)
  })

  // One key could otherwise make extra users with no network, outside the
  // per-network handle uniqueness. The browser converts before asking.
  it("only takes the Enjin Relay and Canary Relay formats, with a clear message", async () => {
    const w = await wallet()
    const key = decodeAddress(w.address)
    for (const prefix of [42, 0, 2, 1110, 9030, 2134]) {
      const res = await nonceReq(encodeAddress(key, prefix))
      expect(res.status, String(prefix)).toBe(400)
      expect(await res.json()).toEqual({
        ok: false,
        error: "Sign in with your Enjin Relaychain (en…) or Canary Relaychain (cn…) address.",
      })
    }
    expect(io.nonces.size).toBe(0)
    expect((await nonceReq(encodeAddress(key, 2135))).status).toBe(200)
    expect((await nonceReq(encodeAddress(key, 69))).status).toBe(200)
  })

  it("is rate limited per client IP: the 11th request in a minute gets 429 and stores nothing", async () => {
    const w = await wallet()
    for (let i = 0; i < RATE_LIMITS.authNonce.limit; i += 1) {
      expect((await nonceReq(w.address)).status).toBe(200)
    }
    const blocked = await nonceReq(w.address)
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(io.nonces.size).toBe(RATE_LIMITS.authNonce.limit)

    // Keyed on the first X-Forwarded-For hop, under the auth-nonce ceiling.
    expect(vi.mocked(enforceRateLimit).mock.calls[0][0]).toEqual({
      ...RATE_LIMITS.authNonce,
      identity: IP,
    })
    // A different client is not affected.
    expect((await nonceReq(w.address, { "x-forwarded-for": "198.51.100.1" })).status).toBe(200)
  })

  it("answers 503 without touching storage when the database is not configured", async () => {
    io.dbConfigured = false
    const w = await wallet()
    expect((await nonceReq(w.address)).status).toBe(503)
    expect(io.nonces.size).toBe(0)
    expect(enforceRateLimit).not.toHaveBeenCalled()
  })

  it("answers 500 when the nonce cannot be stored", async () => {
    const w = await wallet()
    io.failInsertNonce = new Error("boom")
    const res = await nonceReq(w.address)
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })

  it("does not echo the database error text to the caller", async () => {
    const w = await wallet()
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    io.failInsertNonce = new Error('relation "auth_nonces" does not exist')
    const res = await nonceReq(w.address)
    expect(await res.json()).toEqual({ ok: false, error: "Could not start sign-in - try again." })
    log.mockRestore()
  })
})

describe("POST /api/auth/verify", () => {
  it("signs in with a real signature: session cookie flags, hashed token at rest, public user shape", async () => {
    const w = await wallet()
    const { nonce, message } = await issue(w)
    const before = Date.now()
    const res = await verifyReq({ address: w.address, nonce, signature: w.sign(message) })
    expect(res.status).toBe(200)

    const line = setCookie(res, SESSION_COOKIE)
    const token = cookieValue(line)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(line).toMatch(/;\s*HttpOnly/i)
    expect(line).toMatch(/;\s*SameSite=lax/i)
    expect(line).toMatch(/;\s*Path=\/(;|$)/)
    // Not "Secure" outside production (so local http works); see the next test.
    expect(line).not.toMatch(/;\s*Secure/i)
    const expires = Date.parse(/Expires=([^;]+)/i.exec(line)![1])
    expect(expires).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 + SESSION_TTL_MS - 1000)
    expect(expires).toBeLessThanOrEqual(Date.now() + SESSION_TTL_MS)

    // Only the SHA-256 of the bearer token is stored, never the token.
    expect([...io.sessions.keys()]).toEqual([sha256(token)])
    const session = io.sessions.get(sha256(token))!
    expect(JSON.stringify(session)).not.toContain(token)
    expect(session).toMatchObject({
      address: w.address,
      userAgent: "vitest-wallet",
      ipAddress: IP,
    })

    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain(token)
    expect(body).toEqual({
      ok: true,
      user: {
        id: "user-1",
        address: w.address,
        handle: null,
        display_name: null,
        avatar_url: null,
      },
    })
    // The nonce is gone.
    expect(io.nonces.has(nonce)).toBe(false)
  })

  it("signs in when a proxy sends a forwarded-for value that isn't an IP", async () => {
    const w = await wallet()
    const { nonce, message } = await issue(w)
    const res = await verifyReq(
      { address: w.address, nonce, signature: w.sign(message) },
      { "x-forwarded-for": "unknown" },
    )
    expect(res.status).toBe(200)
    const [session] = [...io.sessions.values()]
    expect(session).toMatchObject({ ipAddress: null })
  })

  it("marks the session cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const w = await wallet()
    const { nonce, message } = await issue(w)
    const res = await verifyReq({ address: w.address, nonce, signature: w.sign(message) })
    expect(res.status).toBe(200)
    expect(setCookie(res, SESSION_COOKIE)).toMatch(/;\s*Secure/i)
  })

  it("signs a Canary key in as its cn… address", async () => {
    const w = await wallet(69)
    const { nonce, message } = await issue(w)
    const res = await verifyReq({ address: w.address, nonce, signature: w.sign(message) })
    expect(res.status).toBe(200)
    expect((await res.json()).user.address).toBe(w.address)
  })

  it("refuses a generic-format address even with a validly signed nonce", async () => {
    // A nonce stored before the format rule (or planted) still can't make a
    // user row without a network.
    const w = await wallet(42)
    const nonce = "a".repeat(32)
    const message = `Enjin Governance - sign in\n\nAddress: ${w.address}\nNonce: ${nonce}`
    io.nonces.set(nonce, { address: w.address, message, expiresAt: new Date(Date.now() + 60_000) })
    const res = await verifyReq({ address: w.address, nonce, signature: w.sign(message) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Enjin Relaychain \(en…\) or Canary Relaychain/)
    expect(res.headers.getSetCookie()).toEqual([])
    expect(io.users.size).toBe(0)
    expect(io.sessions.size).toBe(0)
  })

  it("a nonce works once: replaying the same signed request is refused", async () => {
    const w = await wallet()
    const { nonce, message } = await issue(w)
    const body = { address: w.address, nonce, signature: w.sign(message) }
    expect((await verifyReq(body)).status).toBe(200)

    const replay = await verifyReq(body)
    expect(replay.status).toBe(401)
    expect(replay.headers.getSetCookie()).toEqual([])
    expect(io.sessions.size).toBe(1)
  })

  it("a signature from another key is refused and burns the nonce", async () => {
    const victim = await wallet()
    const attacker = await wallet()
    const { nonce, message } = await issue(victim)

    const forged = await verifyReq({
      address: victim.address,
      nonce,
      signature: attacker.sign(message),
    })
    expect(forged.status).toBe(401)
    expect(forged.headers.getSetCookie()).toEqual([])
    expect(io.sessions.size).toBe(0)
    expect(io.users.size).toBe(0)

    // The nonce was consumed by the failed attempt, so it can't be retried.
    const late = await verifyReq({
      address: victim.address,
      nonce,
      signature: victim.sign(message),
    })
    expect(late.status).toBe(401)
    expect(io.sessions.size).toBe(0)
  })

  it("verifies against the stored message, not one the client supplies", async () => {
    const w = await wallet()
    const { nonce } = await issue(w)
    const own = `Enjin Governance - sign in\n\nAddress: ${w.address}\nNonce: ${nonce}`
    const res = await verifyReq({
      address: w.address,
      nonce,
      message: own,
      signature: w.sign(own),
    })
    expect(res.status).toBe(401)
    expect(io.sessions.size).toBe(0)
  })

  it("a nonce issued to one address can't sign in another", async () => {
    const victim = await wallet()
    const attacker = await wallet()
    const { nonce, message } = await issue(victim)
    const res = await verifyReq({
      address: attacker.address,
      nonce,
      signature: attacker.sign(message),
    })
    expect(res.status).toBe(401)
    expect(io.sessions.size).toBe(0)
  })

  it("refuses an expired nonce with the same answer as an unknown one", async () => {
    const w = await wallet()
    const { nonce, message } = await issue(w)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + NONCE_TTL_MS + 1_000)

    const expired = await verifyReq({ address: w.address, nonce, signature: w.sign(message) })
    expect(expired.status).toBe(401)
    const unknown = await verifyReq({
      address: w.address,
      nonce: "0".repeat(32),
      signature: w.sign(message),
    })
    expect(unknown.status).toBe(401)
    // No oracle for "expired" vs "never existed".
    expect(await expired.json()).toEqual(await unknown.json())
    expect(io.sessions.size).toBe(0)
  })

  it("validates the body before touching the nonce", async () => {
    const w = await wallet()
    const { nonce, message } = await issue(w)
    const good = { address: w.address, nonce, signature: w.sign(message) }
    for (const bad of [
      { ...good, nonce: nonce.toUpperCase() },
      { ...good, nonce: nonce.slice(1) },
      { ...good, nonce: `${nonce}' OR '1'='1` },
      { ...good, signature: "not-hex" },
      { ...good, signature: good.signature.slice(2) },
      { ...good, address: "e".repeat(65) },
      { ...good, address: "not-an-address" },
      { nonce, signature: good.signature },
    ]) {
      expect((await verifyReq(bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect((await VERIFY(post("/api/auth/verify", "{"))).status).toBe(400)
    // Still usable: nothing above consumed it.
    expect(io.nonces.has(nonce)).toBe(true)
    expect((await verifyReq(good)).status).toBe(200)
  })

  it("logs a failed signature without the signature itself", async () => {
    const w = await wallet()
    const other = await wallet()
    const { nonce, message } = await issue(w)
    const signature = other.sign(message)
    await verifyReq({ address: w.address, nonce, signature })
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(warn.mock.calls[0])
    expect(logged).not.toContain(signature.slice(2, 40))
    expect(logged).not.toContain(message)
  })

  it("is rate limited per client IP before the nonce is looked at", async () => {
    const w = await wallet()
    const { nonce, message } = await issue(w)
    // Burn the budget with junk requests.
    for (let i = 0; i < RATE_LIMITS.authVerify.limit; i += 1) {
      expect((await verifyReq({})).status).toBe(400)
    }
    const res = await verifyReq({ address: w.address, nonce, signature: w.sign(message) })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(res.headers.getSetCookie()).toEqual([])
    expect(io.nonces.has(nonce)).toBe(true)
    expect(vi.mocked(enforceRateLimit).mock.calls.at(-1)![0]).toEqual({
      ...RATE_LIMITS.authVerify,
      identity: IP,
    })
  })

  it("answers 503 when the database is not configured", async () => {
    io.dbConfigured = false
    const res = await verifyReq({ address: "x", nonce: "0".repeat(32), signature: "0x00" })
    expect(res.status).toBe(503)
  })
})

describe("GET /api/auth/me and POST /api/auth/logout", () => {
  async function signIn(w: Wallet): Promise<string> {
    const { nonce, message } = await issue(w)
    const res = await verifyReq({ address: w.address, nonce, signature: w.sign(message) })
    expect(res.status).toBe(200)
    const token = cookieValue(setCookie(res, SESSION_COOKIE))
    io.jar.set(SESSION_COOKIE, token)
    return token
  }

  it("needs a live session cookie", async () => {
    const out = await ME()
    expect(out.status).toBe(401)
    expect(out.headers.get("cache-control")).toBe("private, no-store")
    io.jar.set(SESSION_COOKIE, "f".repeat(64))
    expect((await ME()).status).toBe(401)
  })

  it("returns only the public profile fields for the signed-in user", async () => {
    const w = await wallet()
    await signIn(w)
    const res = await ME()
    expect(res.status).toBe(200)
    // Personal: no browser or shared cache keeps it.
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    const body = await res.json()
    expect(Object.keys(body.user).sort()).toEqual(
      ["address", "avatar_url", "bio", "display_name", "handle", "id"].sort(),
    )
    expect(body.user.address).toBe(w.address)
    // No session hash, storage key or other row internals.
    expect(JSON.stringify(body)).not.toMatch(/sessionTokenHash|avatar_key|secret-key/)
  })

  it("stops honouring a session once it has expired", async () => {
    const w = await wallet()
    await signIn(w)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + SESSION_TTL_MS + 1_000)
    expect((await ME()).status).toBe(401)
  })

  it("treats every session as signed out when the database is not configured", async () => {
    const w = await wallet()
    await signIn(w)
    io.dbConfigured = false
    expect((await ME()).status).toBe(401)
  })

  it("logout deletes the server-side session and expires the cookie", async () => {
    const w = await wallet()
    const token = await signIn(w)
    const other = await wallet()
    io.jar.clear()
    const otherToken = await signIn(other)
    io.jar.set(SESSION_COOKIE, token)

    const res = await LOGOUT()
    expect(res.status).toBe(200)
    const line = setCookie(res, SESSION_COOKIE)
    expect(cookieValue(line)).toBe("")
    expect(line).toMatch(/;\s*Max-Age=0/i)
    expect(line).toMatch(/;\s*HttpOnly/i)
    expect(line).toMatch(/;\s*SameSite=lax/i)
    expect(line).toMatch(/;\s*Path=\/(;|$)/)

    // Only this session is gone; the old token no longer signs anyone in.
    expect(io.sessions.has(sha256(token))).toBe(false)
    expect(io.sessions.has(sha256(otherToken))).toBe(true)
    expect((await ME()).status).toBe(401)
  })

  it("logout without a cookie, or with the database down, still clears the cookie", async () => {
    const res = await LOGOUT()
    expect(res.status).toBe(200)
    expect(cookieValue(setCookie(res, SESSION_COOKIE))).toBe("")

    const w = await wallet()
    await signIn(w)
    io.failDeleteSession = true
    const down = await LOGOUT()
    expect(down.status).toBe(200)
    expect(await down.json()).toEqual({ ok: true })
    expect(setCookie(down, SESSION_COOKIE)).toMatch(/;\s*Max-Age=0/i)
  })

  it("marks the logout cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(setCookie(await LOGOUT(), SESSION_COOKIE)).toMatch(/;\s*Secure/i)
  })
})

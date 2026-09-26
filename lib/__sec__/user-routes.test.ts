/**
 * Profile routes: /api/users/me (GET, PATCH), /api/users/me/avatar and the
 * public lookups /api/users/by-address/[address] and /api/users/by-addresses.
 * Real route handlers, the real suspension check, handle / display-name
 * policy, rate limiter (in-process) and image transcode (sharp) run. Only I/O
 * is faked: the session lookup, the users / moderation tables and the bucket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type * as RateLimit from "@/lib/rate-limit"
import sharp from "sharp"

const USER = "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH"
const OTHER = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"

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
  is_verified?: boolean
}

const io = vi.hoisted(() => ({
  me: null as null | (Record<string, unknown> & { id: string; address: string }),
  dbConfigured: true,
  r2Configured: true,
  users: new Map<string, Record<string, unknown>>(),
  lookups: [] as unknown[],
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  updateError: null as Error | null,
  avatars: [] as Array<{ id: string; url: string; key: string }>,
  bucket: new Map<string, { body: Buffer; contentType: string; cacheControl?: string }>(),
  suspended: new Map<string, Date>(),
  suspensionError: null as Error | null,
  publicUrlMisconfigured: false,
}))

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => io.me }))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => io.dbConfigured,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/db/users", () => ({
  getUserByAddress: async (address: string) => io.users.get(address) ?? null,
  getUsersByAddresses: async (addresses: string[]) => {
    io.lookups.push(addresses)
    return addresses.flatMap((a) => (io.users.has(a) ? [io.users.get(a)] : []))
  },
  updateProfile: async (id: string, patch: Record<string, unknown>) => {
    if (io.updateError) throw io.updateError
    io.updates.push({ id, patch })
    return { ...io.me, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) }
  },
  setAvatar: async (id: string, url: string, key: string) => void io.avatars.push({ id, url, key }),
}))
vi.mock("@/lib/db/moderation", () => ({
  getSuspension: async (key: string) => {
    if (io.suspensionError) throw io.suspensionError
    return io.suspended.get(key) ?? null
  },
  getGrantedRole: async () => null,
}))
vi.mock("@/lib/r2/client", () => ({
  isR2Configured: () => io.r2Configured,
  isPublicUrlMisconfigured: () => io.publicUrlMisconfigured,
  PUBLIC_URL_NOT_CONFIGURED: "The site's public URL isn't configured.",
  r2Bucket: () => "enjin-governance",
  publicAssetBase: () => "https://fake.local/r",
}))
vi.mock("@/lib/r2/upload", () => ({
  putObject: async (a: {
    key: string
    body: Buffer
    contentType: string
    cacheControl?: string
  }) => {
    io.bucket.set(a.key, { body: a.body, contentType: a.contentType, cacheControl: a.cacheControl })
    return {
      key: a.key,
      url: `https://fake.local/r/${a.key}`,
      sha256: "0".repeat(64),
      sizeBytes: a.body.byteLength,
    }
  },
}))
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof RateLimit>()
  return { ...real, enforceRateLimit: vi.fn(real.enforceRateLimit) }
})

import { __resetRateLimitStore, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { publicKeyOf } from "@/lib/chain/ss58"
import { userAvatarKey } from "@/lib/r2/paths"
import { AVATAR_SIZE_PX } from "@/lib/r2/avatar"
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/limits"
import { GET as ME, PATCH } from "@/app/api/users/me/route"
import { POST as AVATAR } from "@/app/api/users/me/avatar/route"
import { GET as BY_ADDRESS } from "@/app/api/users/by-address/[address]/route"
import { POST as BY_ADDRESSES } from "@/app/api/users/by-addresses/route"

const ME_ID = "11111111-1111-4111-8111-111111111111"
const PUBLIC_FIELDS = ["address", "avatar_url", "bio", "display_name", "handle", "id"]

function row(address: string, over: Partial<Row> = {}): Row {
  return {
    id: `id-${address.slice(0, 6)}`,
    address,
    network: "enjin-relay",
    handle: null,
    display_name: null,
    bio: null,
    avatar_url: null,
    avatar_key: "user-avatars/private.png",
    avatar_updated_at: new Date(0),
    created_at: new Date("2026-01-02T03:04:05Z"),
    updated_at: new Date(0),
    ...over,
  }
}
const signIn = () => {
  io.me = { ...row(USER, { id: ME_ID, handle: "alice" }), sessionTokenHash: "a".repeat(64) }
}
const suspend = (address: string) =>
  io.suspended.set(`0x${publicKeyOf(address)}`, new Date("2030-01-01T00:00:00Z"))

const patch = (body: unknown) =>
  PATCH(
    new NextRequest("https://gov.test/api/users/me", {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  )

function avatar(file: Blob | string | null, filename = "me.png") {
  const form = new FormData()
  if (typeof file === "string") form.set("file", file)
  else if (file) form.set("file", file, filename)
  return AVATAR(
    new NextRequest("https://gov.test/api/users/me/avatar", { method: "POST", body: form }),
  )
}
const file = (bytes: Uint8Array | string, type: string) =>
  new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], { type })

async function png(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer()
}

beforeEach(() => {
  io.me = null
  io.dbConfigured = true
  io.r2Configured = true
  io.users.clear()
  io.lookups.length = 0
  io.updates.length = 0
  io.updateError = null
  io.avatars.length = 0
  io.bucket.clear()
  io.suspended.clear()
  io.suspensionError = null
  io.publicUrlMisconfigured = false
  __resetRateLimitStore()
  vi.mocked(enforceRateLimit).mockClear()
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
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("GET /api/users/me", () => {
  it("needs a session", async () => {
    expect((await ME()).status).toBe(401)
  })

  it("returns only the public profile fields", async () => {
    signIn()
    const body = await (await ME()).json()
    expect(Object.keys(body.user).sort()).toEqual(PUBLIC_FIELDS)
    expect(JSON.stringify(body)).not.toMatch(/sessionTokenHash|avatar_key|private\.png/)
  })
})

describe("PATCH /api/users/me", () => {
  it("needs a session", async () => {
    expect((await patch({ bio: "hi" })).status).toBe(401)
    expect(io.updates).toEqual([])
  })

  it("updates only the caller's own row, and only the three editable fields", async () => {
    signIn()
    const res = await patch({
      display_name: "Alice",
      bio: "hello",
      handle: "alice_2",
      // None of these may be set through this route.
      id: "22222222-2222-4222-8222-222222222222",
      address: OTHER,
      avatar_url: "https://evil.example/x.png",
      avatar_key: "proposals/enjin-relay/x/proposal.json",
      is_verified: true,
      network: "canary-relay",
    })
    expect(res.status).toBe(200)
    expect(io.updates).toEqual([
      { id: ME_ID, patch: { display_name: "Alice", bio: "hello", handle: "alice_2" } },
    ])
    const body = await res.json()
    expect(Object.keys(body.user).sort()).toEqual(PUBLIC_FIELDS)
    expect(body.user).toMatchObject({ id: ME_ID, address: USER, handle: "alice_2" })
  })

  it("is refused for a suspended account, and fails closed if the check can't run", async () => {
    signIn()
    suspend(USER)
    const res = await patch({ bio: "back again" })
    expect(res.status).toBe(403)

    io.suspended.clear()
    io.suspensionError = new Error("connection reset")
    expect((await patch({ bio: "back again" })).status).toBe(503)
    expect(io.updates).toEqual([])
  })

  it("enforces the length caps and types", async () => {
    signIn()
    for (const body of [
      { bio: "x".repeat(501) },
      { display_name: "x".repeat(81) },
      { handle: "x".repeat(33) },
      { handle: "ab" },
      { handle: 123 },
      { bio: { $set: "x" } },
      [],
    ]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await patch("{not json")).status).toBe(400)
    expect(io.updates).toEqual([])
    // At the caps is fine.
    expect((await patch({ bio: "x".repeat(500), display_name: "y".repeat(80) })).status).toBe(200)
  })

  it("refuses reserved, malformed and abusive handles and impersonating display names", async () => {
    signIn()
    for (const body of [
      { handle: "admin" },
      { handle: "moderator" },
      { handle: "enjin" },
      { handle: "Alice" },
      { handle: "alice.eth" },
      { handle: "<script>" },
      { handle: "al ice" },
      { handle: "nazi_fan" },
      { display_name: "Enjin Support" },
      { display_name: "The OFFICIAL ENJIN desk" },
      { display_name: "Verified Account" },
    ]) {
      const res = await patch(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await res.json()).error).toMatch(/handle|display name/i)
    }
    expect(io.updates).toEqual([])
  })

  // Stored untrimmed, "\uFEFFalice" (invisible BOM) or "alice\u3000" would get
  // past the (network, handle) unique index as a look-alike of @alice.
  it("stores handles trimmed, so padding can't make a look-alike", async () => {
    signIn()
    for (const handle of ["\uFEFFalice", "alice\u3000", "alice ", " alice"]) {
      expect((await patch({ handle })).status, JSON.stringify(handle)).toBe(200)
    }
    expect(io.updates.map((u) => u.patch.handle)).toEqual(["alice", "alice", "alice", "alice"])
    // A zero-width space isn't whitespace: it stays in and fails the format check.
    expect((await patch({ handle: "\u200Balice" })).status).toBe(400)
  })

  // "Enjin\u00A0Support" used to slip past the check; see handle-blocklist.test.ts
  // for the full set of look-alikes.
  it("refuses impersonating display names written with look-alike spaces or invisibles", async () => {
    signIn()
    for (const display_name of [
      "Enjin\u00A0Support",
      "Enjin\u3000Support",
      "Enjin \u200B Support",
      "\u202EOfficial Enjin",
      "Ｅｎｊｉｎ Ｓｕｐｐｏｒｔ",
    ]) {
      const res = await patch({ display_name })
      expect(res.status, JSON.stringify(display_name)).toBe(400)
      expect((await res.json()).error).toMatch(/display name/i)
    }
    expect(io.updates).toEqual([])
  })

  it("stores the display name without invisible or direction-control characters", async () => {
    signIn()
    // U+202E would make "troppuS nijnE" display as "Enjin Support".
    expect((await patch({ display_name: "\u202Etroppus nijnE" })).status).toBe(200)
    expect((await patch({ display_name: "  Alice\u200B\u00A0\u00A0Smith\u2069 " })).status).toBe(
      200,
    )
    expect(io.updates.map((u) => u.patch.display_name)).toEqual(["troppus nijnE", "Alice Smith"])
  })

  it("won't set a handle on a user row that has no network", async () => {
    // Rows made before sign-in was limited to the relay formats (a generic
    // 5… address) sit outside the per-network handle unique index.
    signIn()
    io.me = { ...io.me!, network: null }
    const res = await patch({ handle: "alice_2" })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/sign in again/i)
    expect(io.updates).toEqual([])
    // The rest of the profile can still change.
    expect((await patch({ bio: "hello" })).status).toBe(200)
  })

  it("is rate limited per user: the 21st save in 10 minutes gets 429", async () => {
    signIn()
    for (let i = 0; i < RATE_LIMITS.profileUpdate.limit; i += 1) {
      expect((await patch({ bio: `bio ${i}` })).status).toBe(200)
    }
    const res = await patch({ handle: "alice_3" })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(io.updates).toHaveLength(RATE_LIMITS.profileUpdate.limit)
    expect(vi.mocked(enforceRateLimit).mock.calls[0][0]).toEqual({
      ...RATE_LIMITS.profileUpdate,
      identity: ME_ID,
    })
    // Someone else is not affected.
    io.me = { ...row(OTHER), sessionTokenHash: "b".repeat(64) }
    expect((await patch({ bio: "mine" })).status).toBe(200)
  })

  it("a taken handle is a 409 with a fixed message", async () => {
    signIn()
    io.updateError = new Error(
      'duplicate key value violates unique constraint "users_network_handle_unique"',
    )
    const res = await patch({ handle: "bob" })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ ok: false, error: "That handle is already taken." })
  })

  it("does not echo database error text on a failed update", async () => {
    signIn()
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    io.updateError = new Error('relation "users" does not exist')
    const res = await patch({ bio: "hello" })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      ok: false,
      error: "Could not save your profile - try again.",
    })
    log.mockRestore()
  })
})

describe("POST /api/users/me/avatar", () => {
  it("needs storage and a session, and refuses a suspended account", async () => {
    io.r2Configured = false
    expect((await avatar(file(await png(), "image/png"))).status).toBe(503)
    io.r2Configured = true
    expect((await avatar(file(await png(), "image/png"))).status).toBe(401)

    signIn()
    suspend(USER)
    expect((await avatar(file(await png(), "image/png"))).status).toBe(403)
    expect(io.bucket.size).toBe(0)
    expect(io.avatars).toEqual([])
    expect(enforceRateLimit).not.toHaveBeenCalled()
  })

  it("503s before storing anything when the site's public URL isn't configured", async () => {
    signIn()
    io.publicUrlMisconfigured = true
    const res = await avatar(file(await png(), "image/png"))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      error: "The site's public URL isn't configured.",
    })
    expect(io.bucket.size).toBe(0)
    expect(io.avatars).toEqual([])
  })

  it("stores a 150px PNG under the caller's own key, whatever the upload was called", async () => {
    signIn()
    const input = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExif({ IFD0: { Make: "PhoneCo", Artist: "Alice Home Address" } })
      .jpeg()
      .toBuffer()
    expect((await sharp(input).metadata()).exif).toBeDefined()

    const res = await avatar(file(input, "image/jpeg"), "../../proposals/x/proposal.json")
    expect(res.status).toBe(200)
    const key = userAvatarKey(ME_ID)
    expect([...io.bucket.keys()]).toEqual([key])
    const stored = io.bucket.get(key)!
    expect(stored.contentType).toBe("image/png")
    const meta = await sharp(stored.body).metadata()
    expect(meta).toMatchObject({ format: "png", width: AVATAR_SIZE_PX, height: AVATAR_SIZE_PX })
    expect(meta.exif).toBeUndefined()

    const { avatar_url } = await res.json()
    expect(avatar_url).toMatch(new RegExp(`^https://fake\\.local/r/${key}\\?v=\\d+$`))
    expect(io.avatars).toEqual([{ id: ME_ID, url: avatar_url, key }])
  })

  it("accepts up to 4 MB and answers 413 above it, before decoding anything", async () => {
    signIn()
    const over = await avatar(file(new Uint8Array(MAX_UPLOAD_BYTES + 1), "image/png"))
    expect(over.status).toBe(413)
    expect((await over.json()).error).toMatch(/4 MB/)

    // Exactly the limit gets past the size check (and then fails to decode).
    const atLimit = await avatar(file(new Uint8Array(MAX_UPLOAD_BYTES), "image/png"))
    expect(atLimit.status).toBe(400)
    expect(io.bucket.size).toBe(0)
  })

  it("only takes raster image types (no SVG / HTML), and re-encodes whatever it takes", async () => {
    signIn()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    for (const type of ["image/svg+xml", "text/html", "application/octet-stream", ""]) {
      const res = await avatar(file(await png(), type))
      expect(res.status, type).toBe(415)
    }
    // HTML declared as a PNG never decodes, so nothing is stored.
    const html = await avatar(file("<html><script>alert(1)</script></html>", "image/png"))
    expect(html.status).toBe(400)
    expect(io.bucket.size).toBe(0)

    // SVG smuggled in as "image/png": whatever sharp makes of it, only a
    // re-encoded PNG is stored, never the original markup.
    const res = await avatar(file(svg, "image/png"))
    if (res.status === 200) {
      const stored = io.bucket.get(userAvatarKey(ME_ID))!
      expect(stored.contentType).toBe("image/png")
      expect(stored.body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
      expect(stored.body.toString("latin1")).not.toContain("<script")
    } else {
      expect(res.status).toBe(400)
      expect(io.bucket.size).toBe(0)
    }
  })

  it("rejects a missing, non-file or empty part", async () => {
    signIn()
    expect((await avatar(null)).status).toBe(400)
    expect((await avatar("just a string")).status).toBe(400)
    expect((await avatar(file(new Uint8Array(0), "image/png"))).status).toBe(400)
    const notMultipart = await AVATAR(
      new NextRequest("https://gov.test/api/users/me/avatar", {
        method: "POST",
        body: JSON.stringify({ file: "x" }),
        headers: { "content-type": "application/json" },
      }),
    )
    expect(notMultipart.status).toBe(400)
    expect(io.bucket.size).toBe(0)
  })

  it("is rate limited per user: the 11th upload in 5 minutes gets 429", async () => {
    signIn()
    const small = await png(20, 20)
    for (let i = 0; i < RATE_LIMITS.avatarUpload.limit; i += 1) {
      expect((await avatar(file(small, "image/png"))).status).toBe(200)
    }
    const res = await avatar(file(small, "image/png"))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(io.avatars).toHaveLength(RATE_LIMITS.avatarUpload.limit)
    expect(vi.mocked(enforceRateLimit).mock.calls[0][0]).toEqual({
      ...RATE_LIMITS.avatarUpload,
      identity: ME_ID,
    })
  })
})

describe("GET /api/users/by-address/[address]", () => {
  const get = (address: string) =>
    BY_ADDRESS(new NextRequest(`https://gov.test/api/users/by-address/${address}`), {
      params: Promise.resolve({ address }),
    })

  it("returns the public profile only, with is_verified defaulting to false", async () => {
    io.users.set(OTHER, row(OTHER, { handle: "bob", bio: "hi" }))
    const res = await get(OTHER)
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=600")
    const body = await res.json()
    expect(Object.keys(body.user).sort()).toEqual(
      [...PUBLIC_FIELDS, "created_at", "is_verified"].sort(),
    )
    expect(body.user).toMatchObject({ address: OTHER, handle: "bob", is_verified: false })
    expect(JSON.stringify(body)).not.toMatch(/avatar_key|private\.png|network/)
  })

  it("400s on a too-short address, 404s on an unknown one, 503s without a database", async () => {
    expect((await get("abc")).status).toBe(400)
    expect((await get("")).status).toBe(400)
    const missing = await get(USER)
    expect(missing.status).toBe(404)
    expect(missing.headers.get("cache-control")).toBeNull()
    io.dbConfigured = false
    expect((await get(OTHER)).status).toBe(503)
  })
})

describe("POST /api/users/by-addresses", () => {
  const post = (body: unknown) =>
    BY_ADDRESSES(
      new NextRequest("https://gov.test/api/users/by-addresses", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    )

  it("returns public profiles only, de-duplicating the lookup", async () => {
    io.users.set(OTHER, row(OTHER, { handle: "bob", is_verified: true }))
    const res = await post({ addresses: [OTHER, OTHER, USER] })
    expect(res.status).toBe(200)
    expect(io.lookups).toEqual([[OTHER, USER]])
    const { users } = await res.json()
    expect(users).toHaveLength(1)
    expect(Object.keys(users[0]).sort()).toEqual(
      [...PUBLIC_FIELDS, "created_at", "is_verified"].sort(),
    )
    expect(users[0]).toMatchObject({ address: OTHER, is_verified: true })
    expect(JSON.stringify(users)).not.toMatch(/avatar_key|private\.png/)
  })

  it("caps the batch at 100 and each entry at 4-64 chars, without querying on a bad body", async () => {
    const many = Array.from({ length: 101 }, (_, i) => `addr${i}`)
    for (const body of [
      { addresses: many },
      { addresses: [] },
      { addresses: ["abc"] },
      { addresses: ["x".repeat(65)] },
      { addresses: [OTHER, 7] },
      { addresses: OTHER },
      {},
    ]) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: "Invalid body" })
    }
    expect(await (await post("{")).json()).toEqual({ ok: false, error: "Invalid JSON body" })
    expect(io.lookups).toEqual([])
    expect((await post({ addresses: many.slice(0, 100) })).status).toBe(200)
  })

  it("503s without a database", async () => {
    io.dbConfigured = false
    expect((await post({ addresses: [OTHER] })).status).toBe(503)
  })
})

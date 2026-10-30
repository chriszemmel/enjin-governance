/**
 * Moderation administration: roles (admins only, stored by public key,
 * admins from the server configuration can't be removed, moderators can't
 * raise themselves), the queue and held media (moderators and admins
 * only, never cached), the public log (no reporter, no account behind a
 * pause, no internal ids) and /me. Real route handlers and the real role
 * check against GOVERNANCE_ADMIN_PUBLIC_KEYS; only I/O is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"

const ADMIN = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const MOD = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const USER = "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH"

vi.hoisted(() => {
  // One admin as an address, one as a raw public key.
  process.env.GOVERNANCE_ADMIN_PUBLIC_KEYS = `enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA, 0x${"22".repeat(32)}`
})
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; address: string; handle: string | null },
}))
const storage = vi.hoisted(() => ({ configured: true }))
const notices = vi.hoisted(() => [] as unknown[])

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => auth.user }))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/r2/client", () => ({
  isPublicUrlMisconfigured: () => false,
  PUBLIC_URL_NOT_CONFIGURED: "The site's public URL isn't configured.",
  isR2Configured: () => storage.configured,
  r2Bucket: () => "enjin-governance",
  publicAssetBase: () => "https://fake.local/r",
  getR2Client: () => ({
    send: async (cmd: { input: { Key: string } }) => {
      const e = bucketMod.bucket.get(cmd.input.Key)
      if (!e) throw Object.assign(new Error("missing"), { name: "NoSuchKey" })
      return {
        Body: { transformToByteArray: async () => new Uint8Array(bucketMod.bytesOf(e)) },
        ContentType: e.contentType,
      }
    },
  }),
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: async () => ({ allowed: true, remaining: 9, resetAt: 0, retryAfterSeconds: 0 }),
  RATE_LIMITS: {},
}))
vi.mock("@/lib/moderation/notify", () => ({
  notifyNewReport: async (n: unknown) => void notices.push(n),
}))
vi.mock("@/lib/db/comments", () => ({ getCommentById: async () => null }))
vi.mock("@/lib/db/moderation", async () => await import("./fake-moderation"))
vi.mock("@/lib/db/proposals", async () => await import("./fake-db"))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))

import * as bucketMod from "./fake-bucket"
import * as db from "./fake-db"
import * as mod from "./fake-moderation"
import { publicKeyOf } from "@/lib/chain/ss58"
import { GET as ROLES, POST as GRANT, DELETE as REVOKE } from "@/app/api/moderation/roles/route"
import { GET as QUEUE } from "@/app/api/moderation/queue/route"
import { GET as MEDIA } from "@/app/api/moderation/media/route"
import { GET as LOG } from "@/app/api/moderation/log/route"
import { GET as ME } from "@/app/api/moderation/me/route"
import { POST as REPORT } from "@/app/api/moderation/reports/route"
import { POST as ACT } from "@/app/api/moderation/actions/route"
import { GET as READ } from "@/app/r/[...key]/route"

const NET = "enjin-relay"
const PID = "22222222-2222-4222-8222-222222222222"
const FILE = `proposals/${NET}/${PID}/media/ab12cd34-wallet.png`
/** The second env admin, configured by its 0x public key. */
const ADMIN2 = encodeAddress(new Uint8Array(32).fill(0x22), 2135)

const asMatrix = (address: string) => encodeAddress(decodeAddress(address), 1110)
const asRelay = (address: string) => encodeAddress(decodeAddress(address), 2135)
const pk = (address: string) => `0x${publicKeyOf(address)}`
const signIn = (address: string) => {
  auth.user = { id: `user-${address.slice(0, 6)}`, address, handle: null }
}
const json = (method: string, path: string, body: unknown) =>
  new NextRequest(`https://gov.test${path}`, {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
const grant = (body: unknown) => GRANT(json("POST", "/api/moderation/roles", body))
const revoke = (body: unknown) => REVOKE(json("DELETE", "/api/moderation/roles", body))
const roleOf = async () => ((await (await ME()).json()) as { role: string | null }).role
const media = (key: string) =>
  MEDIA(new NextRequest(`https://gov.test/api/moderation/media?key=${encodeURIComponent(key)}`))
const log = async (query = "") => {
  const res = await LOG(new NextRequest(`https://gov.test/api/moderation/log${query}`))
  return { res, body: (await res.json()) as { items: Record<string, unknown>[] } }
}

beforeEach(() => {
  db.reset()
  bucketMod.resetBucket()
  mod.resetModeration()
  notices.length = 0
  storage.configured = true
  auth.user = null
  mod.roles.set(pk(MOD), { role: "moderator", granted_by: null, created_at: new Date(0) })
  db.seedProposal({
    id: PID,
    network: NET,
    proposer_address: USER,
    status: "on_chain",
    referendum_index: 214,
    json_key: `proposals/${NET}/${PID}/proposal.json`,
  })
  bucketMod.bucket.set(FILE, { body: "IMG", contentType: "image/png" })
})

describe("roles", () => {
  it("are managed by admins only; a moderator can't raise their own role", async () => {
    const attempts = async () => [
      (await ROLES()).status,
      (await grant({ address: MOD, role: "admin" })).status,
      (await revoke({ address: MOD })).status,
    ]
    expect(await attempts()).toEqual([401, 401, 401])
    signIn(USER)
    expect(await attempts()).toEqual([403, 403, 403])
    signIn(MOD)
    expect(await attempts()).toEqual([403, 403, 403])
    expect(await roleOf()).toBe("moderator")
    expect(mod.roles.get(pk(MOD))?.role).toBe("moderator")
    expect(mod.actions).toEqual([])
  })

  it("are granted and changed by public key, and every grant is logged", async () => {
    signIn(ADMIN)
    // Granted with the Matrixchain address, used with the Relaychain one.
    expect((await grant({ address: USER, role: "moderator" })).status).toBe(200)
    expect(mod.roles.get(pk(USER))).toMatchObject({ role: "moderator", granted_by: pk(ADMIN) })
    expect(mod.actions.at(-1)).toMatchObject({
      target_type: "role",
      target_id: pk(USER),
      action: "grant",
      actor_public_key: pk(ADMIN),
      actor_label: `${ADMIN.slice(0, 6)}…${ADMIN.slice(-4)}`,
    })
    signIn(asRelay(USER))
    expect(await roleOf()).toBe("moderator")

    signIn(ADMIN)
    expect((await grant({ address: USER, role: "admin" })).status).toBe(200)
    expect(mod.actions.filter((a) => a.action === "grant")).toHaveLength(2)
    // A granted admin can manage roles too.
    signIn(asRelay(USER))
    expect(await roleOf()).toBe("admin")
    expect((await ROLES()).status).toBe(200)
  })

  it("can't take away an admin set in the server configuration, in any address format", async () => {
    mod.roles.set(pk(USER), { role: "admin", granted_by: pk(ADMIN), created_at: new Date(1) })
    for (const actor of [ADMIN, USER]) {
      signIn(actor)
      for (const target of [ADMIN, asMatrix(ADMIN), ADMIN2]) {
        const res = await revoke({ address: target })
        expect(res.status).toBe(409)
      }
    }
    // A database row can't demote them either.
    signIn(USER)
    expect((await grant({ address: ADMIN, role: "moderator" })).status).toBe(200)
    signIn(asMatrix(ADMIN))
    expect(await roleOf()).toBe("admin")
    signIn(ADMIN2)
    expect(await roleOf()).toBe("admin")
    expect(mod.actions.filter((a) => a.action === "revoke")).toEqual([])
  })

  it("take effect at once when revoked, and a revoke is logged once", async () => {
    signIn(ADMIN)
    const res = await revoke({ address: asMatrix(MOD) })
    expect(await res.json()).toEqual({ ok: true, removed: true })
    expect(mod.roles.has(pk(MOD))).toBe(false)
    expect(mod.actions).toMatchObject([
      { target_type: "role", target_id: pk(MOD), action: "revoke", actor_public_key: pk(ADMIN) },
    ])
    // Nothing left to remove: nothing logged.
    expect(await (await revoke({ address: MOD })).json()).toEqual({ ok: true, removed: false })
    expect(mod.actions).toHaveLength(1)
    signIn(MOD)
    expect(await roleOf()).toBeNull()
    expect((await QUEUE()).status).toBe(403)
  })

  it("accept only a real address and a known role", async () => {
    signIn(ADMIN)
    const before = new Map(mod.roles)
    for (const bad of [
      { address: "x", role: "moderator" },
      { address: "e".repeat(48), role: "moderator" },
      { address: pk(USER), role: "moderator" },
      { address: USER, role: "owner" },
      { address: USER },
      { address: USER, role: "admin", granted_by: pk(MOD) },
      "{not json",
    ]) {
      expect((await grant(bad)).status).toBe(400)
    }
    expect((await revoke({ address: MOD, role: "moderator" })).status).toBe(400)
    expect((await revoke({ address: "not an address at all, but long enough" })).status).toBe(400)
    expect(mod.roles).toEqual(before)
    expect(mod.actions).toEqual([])
  })

  it("list the configured admins as fixed, and database roles once", async () => {
    // A stale database row for a configured admin is not listed twice.
    mod.roles.set(pk(ADMIN), { role: "moderator", granted_by: null, created_at: new Date(1) })
    signIn(ADMIN)
    const res = await ROLES()
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const { items } = (await res.json()) as { items: Record<string, unknown>[] }
    expect(items).toEqual([
      { public_key: pk(ADMIN), role: "admin", fixed: true, created_at: null },
      { public_key: pk(ADMIN2), role: "admin", fixed: true, created_at: null },
      {
        public_key: pk(MOD),
        role: "moderator",
        fixed: false,
        created_at: new Date(0).toISOString(),
      },
    ])
  })
})

describe("queue", () => {
  it("is for moderators and admins only, and never cached", async () => {
    mod.queue.items = [{ target_type: "attachment", target_id: FILE, notes: ["reporter note"] }]
    expect((await QUEUE()).status).toBe(401)
    signIn(USER)
    const refused = await QUEUE()
    expect(refused.status).toBe(403)
    expect(JSON.stringify(await refused.json())).not.toContain("reporter note")
    for (const [who, role] of [
      [MOD, "moderator"],
      [asMatrix(ADMIN), "admin"],
    ] as const) {
      signIn(who)
      const res = await QUEUE()
      expect(res.status).toBe(200)
      expect(res.headers.get("Cache-Control")).toBe("no-store")
      expect(await res.json()).toMatchObject({ ok: true, role, items: mod.queue.items })
    }
  })

  it("stays closed to moderators when roles can't be read", async () => {
    mod.faults.roles = new Error("db down")
    signIn(MOD)
    expect((await QUEUE()).status).toBe(403)
    expect(await roleOf()).toBeNull()
    // Configured admins don't depend on the database.
    signIn(ADMIN)
    expect((await QUEUE()).status).toBe(200)
  })
})

describe("held media", () => {
  beforeEach(() => {
    // Held by the automatic check: the public read route won't serve it.
    mod.states.set(mod.stateKey("attachment", FILE), {
      target_type: "attachment",
      target_id: FILE,
      proposal_id: PID,
      state: "blurred",
      reason: "Held for a moderator by the automatic check.",
      source: "automatic",
      updated_at: new Date(),
    })
  })

  it("is shown to moderators and admins only, and never cached", async () => {
    const pub = await READ(new NextRequest(`https://gov.test/r/${FILE}`), {
      params: Promise.resolve({ key: FILE.split("/") }),
    })
    expect(pub.status).toBe(404)
    expect((await media(FILE)).status).toBe(401)
    signIn(USER)
    expect((await media(FILE)).status).toBe(403)
    for (const who of [MOD, ADMIN]) {
      signIn(who)
      const res = await media(FILE)
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe("image/png")
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("IMG")
    }
  })

  it("serves proposal media files and nothing else from the bucket", async () => {
    signIn(MOD)
    const others = [
      `proposals/${NET}/${PID}/proposal.json`,
      `proposals/${NET}/index/214.json`,
      "user-avatars/99999999-9999-4999-8999-999999999999.png",
      `proposals/${NET}/${PID}/media/../proposal.json`,
      `proposals/${NET}/${PID}/media/..`,
      `proposals/${NET}/${PID}/media/sub/x.png`,
      `proposals/${NET}/${PID}/media/a%2Fb.png`,
      `r/${FILE}`,
      `/${FILE}`,
      "",
    ]
    for (const key of others) {
      bucketMod.bucket.set(key, { body: "SECRET", contentType: "application/json" })
      const res = await media(key)
      expect(res.status).toBe(400)
      expect(await res.text()).not.toContain("SECRET")
    }
    expect((await media(`proposals/${NET}/${PID}/media/ffff0000-gone.png`)).status).toBe(404)
    storage.configured = false
    expect((await media(FILE)).status).toBe(503)
  })
})

describe("public log", () => {
  const LOG_FIELDS = [
    "action",
    "actor",
    "created_at",
    "id",
    "network",
    "reason",
    "referendum_index",
    "source",
    "target_type",
  ]
  const act = (body: unknown) => ACT(json("POST", "/api/moderation/actions", body))

  it("is public and never names reporters or their notes", async () => {
    signIn(USER)
    const note = "It's my neighbour's photo, taken from my phone"
    const reported = await REPORT(
      json("POST", "/api/moderation/reports", {
        target_type: "attachment",
        target_id: FILE,
        category: "personal_data",
        note,
      }),
    )
    expect(reported.status).toBe(200)
    signIn(MOD)
    expect(
      (
        await act({
          target_type: "attachment",
          target_id: FILE,
          action: "hide",
          reason: "Shows a private person.",
        })
      ).status,
    ).toBe(200)

    auth.user = null
    const { res, body } = await log()
    expect(res.status).toBe(200)
    expect(body.items).toEqual([
      expect.objectContaining({
        target_type: "attachment",
        network: NET,
        referendum_index: 214,
        action: "hide",
        reason: "Shows a private person.",
        source: "moderator",
        actor: `${MOD.slice(0, 6)}…${MOD.slice(-4)}`,
      }),
    ])
    expect(Object.keys(body.items[0]!).sort()).toEqual(LOG_FIELDS)
    const raw = JSON.stringify(body)
    for (const secret of [note, USER, pk(USER), "user-efRd63", pk(MOD), FILE, PID]) {
      expect(raw).not.toContain(secret)
    }
  })

  it("doesn't reveal whose posting was paused", async () => {
    signIn(ADMIN)
    expect(
      (
        await act({
          target_type: "user",
          target_id: USER,
          action: "suspend",
          days: 3,
          reason: "Repeated phishing links.",
        })
      ).status,
    ).toBe(200)
    const { body } = await log()
    expect(body.items).toMatchObject([
      { target_type: "user", action: "suspend", reason: "Repeated phishing links." },
    ])
    const raw = JSON.stringify(body)
    for (const secret of [USER, asMatrix(USER), pk(USER), pk(ADMIN)]) {
      expect(raw).not.toContain(secret)
    }
  })

  it("pages by a valid `before` date, 50 at a time, and ignores anything else", async () => {
    await log("?before=2026-03-01T00:00:00Z")
    await log("?before=yesterday")
    await log()
    expect(mod.listActionsCalls).toEqual([
      { limit: 50, before: new Date("2026-03-01T00:00:00Z") },
      { limit: 50, before: undefined },
      { limit: 50, before: undefined },
    ])
  })

  it("is empty, not an error, before the tables exist", async () => {
    mod.faults.actions = mod.missingTable()
    const { res, body } = await log()
    expect(res.status).toBe(200)
    expect(body.items).toEqual([])
  })
})

describe("me", () => {
  it("names the signed-in role and nothing for anyone else, never cached", async () => {
    const res = await ME()
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(await res.json()).toEqual({ ok: true, role: null })
    signIn(USER)
    expect(await roleOf()).toBeNull()
    signIn(asMatrix(MOD))
    expect(await roleOf()).toBe("moderator")
    signIn(asMatrix(ADMIN))
    expect(await roleOf()).toBe("admin")
  })
})

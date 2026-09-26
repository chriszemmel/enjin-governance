/**
 * Moderation routes: who may do what, reasons are required, file deletion
 * really deletes, and hidden media stops being served. Real route handlers
 * and the real role check (env admin list); only I/O is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"

const ADMIN = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const MOD = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const USER = "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH"

vi.hoisted(() => {
  process.env.GOVERNANCE_ADMIN_PUBLIC_KEYS = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
})
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; address: string; handle: string | null },
}))
const mod = vi.hoisted(() => ({
  roles: new Map<string, "moderator" | "admin">(),
  states: new Map<string, { state: string; reason: string }>(),
  actions: [] as Record<string, unknown>[],
  reports: [] as Record<string, unknown>[],
  closed: [] as unknown[],
}))

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => auth.user }))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/r2/client", () => ({
  isR2Configured: () => true,
  r2Bucket: () => "enjin-governance",
  publicAssetBase: () => "https://fake.local/r",
  getR2Client: () => ({
    send: async (cmd: { input: { Key: string } }) => {
      const e = bucketMod.bucket.get(cmd.input.Key)
      if (!e) throw Object.assign(new Error("missing"), { name: "NoSuchKey" })
      return {
        Body: { transformToByteArray: async () => new TextEncoder().encode(e.body) },
        ContentType: e.contentType,
      }
    },
  }),
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: async () => ({ allowed: true, remaining: 9, resetAt: 0, retryAfterSeconds: 0 }),
  RATE_LIMITS: {},
}))
vi.mock("@/lib/db/moderation", () => ({
  getGrantedRole: async (k: string) => mod.roles.get(k) ?? null,
  setState: async (a: { targetType: string; targetId: string; state: string; reason: string }) =>
    void mod.states.set(`${a.targetType}:${a.targetId}`, { state: a.state, reason: a.reason }),
  getState: async (t: string, id: string) => mod.states.get(`${t}:${id}`) ?? null,
  insertAction: async (a: Record<string, unknown>) => void mod.actions.push(a),
  insertReport: async (a: Record<string, unknown>) => {
    mod.reports.push(a)
    return true
  },
  closeReports: async (...a: unknown[]) => void mod.closed.push(a),
  setPostingSuspended: async () => undefined,
}))
vi.mock("@/lib/db/comments", () => ({ getCommentById: async () => null }))
vi.mock("@/lib/db/users", () => ({ getUserByAddress: async () => null }))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))
vi.mock("@/lib/db/proposals", async () => await import("./fake-db"))

import * as bucketMod from "./fake-bucket"
import * as db from "./fake-db"
import { publicKeyOf } from "@/lib/chain/ss58"
import { POST as REPORT } from "@/app/api/moderation/reports/route"
import { POST as ACT } from "@/app/api/moderation/actions/route"
import { GET as READ } from "@/app/r/[...key]/route"

const NET = "enjin-relay"
const PID = "22222222-2222-4222-8222-222222222222"
const FILE = `proposals/${NET}/${PID}/media/ab12cd34-wallet.png`

const post = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
const act = (body: unknown) => ACT(post("https://gov.test/api/moderation/actions", body))
const signIn = (address: string) => {
  auth.user = { id: `id-${address.slice(0, 4)}`, address, handle: null }
}

beforeEach(() => {
  db.reset()
  bucketMod.resetBucket()
  mod.roles.clear()
  mod.states.clear()
  mod.actions.length = 0
  mod.reports.length = 0
  mod.roles.set(`0x${publicKeyOf(MOD)}`, "moderator")
  db.seedProposal({
    id: PID,
    network: NET,
    proposer_address: USER,
    status: "on_chain",
    referendum_index: 214,
    json_key: `proposals/${NET}/${PID}/proposal.json`,
  })
  bucketMod.bucket.set(FILE, { body: "IMG", contentType: "image/png" })
  bucketMod.bucket.set(`${FILE}.thumb.webp`, { body: "THUMB", contentType: "image/webp" })
  auth.user = null
})

describe("reports", () => {
  it("needs a session and a real item", async () => {
    const body = { target_type: "attachment", target_id: FILE, category: "secrets" }
    expect((await REPORT(post("https://gov.test/api/moderation/reports", body))).status).toBe(401)
    signIn(USER)
    const missing = { ...body, target_id: `proposals/${NET}/${PID}/media/nope/../x.png` }
    expect((await REPORT(post("https://gov.test/api/moderation/reports", missing))).status).toBe(
      404,
    )
    const res = await REPORT(post("https://gov.test/api/moderation/reports", body))
    expect(res.status).toBe(200)
    expect(mod.reports).toMatchObject([
      { targetId: FILE, proposalId: PID, severity: "high", source: "user" },
    ])
  })
})

describe("actions", () => {
  it("are for moderators only, and always need a reason", async () => {
    signIn(USER)
    expect(
      (
        await act({
          target_type: "attachment",
          target_id: FILE,
          action: "hide",
          reason: "Recovery phrase",
        })
      ).status,
    ).toBe(403)
    signIn(MOD)
    expect(
      (await act({ target_type: "attachment", target_id: FILE, action: "hide", reason: "" }))
        .status,
    ).toBe(400)
  })

  it("lets a moderator hide an image, which /r then refuses to serve", async () => {
    expect(
      (
        await READ(new NextRequest(`https://gov.test/r/${FILE}`), {
          params: Promise.resolve({ key: FILE.split("/") }),
        })
      ).status,
    ).toBe(200)
    signIn(MOD)
    const res = await act({
      target_type: "attachment",
      target_id: FILE,
      action: "hide",
      reason: "Screenshot shows a recovery phrase.",
    })
    expect(res.status).toBe(200)
    expect(mod.actions).toMatchObject([
      { action: "hide", referendumIndex: 214, actorLabel: expect.stringMatching(/^enCrdz/) },
    ])
    for (const key of [FILE, `${FILE}.thumb.webp`]) {
      const r = await READ(new NextRequest(`https://gov.test/r/${key}`), {
        params: Promise.resolve({ key: key.split("/") }),
      })
      expect(r.status).toBe(404)
    }
    // Hiding never deletes: the file is still in storage for an appeal.
    expect(bucketMod.bucket.has(FILE)).toBe(true)
  })

  it("keeps file deletion for admins, and then really deletes", async () => {
    signIn(MOD)
    expect(
      (
        await act({
          target_type: "attachment",
          target_id: FILE,
          action: "delete_file",
          reason: "Legal takedown",
        })
      ).status,
    ).toBe(403)
    expect(bucketMod.bucket.has(FILE)).toBe(true)
    signIn(ADMIN)
    expect(
      (
        await act({
          target_type: "attachment",
          target_id: FILE,
          action: "delete_file",
          reason: "Legal takedown",
        })
      ).status,
    ).toBe(200)
    expect(bucketMod.bucket.has(FILE)).toBe(false)
    expect(bucketMod.bucket.has(`${FILE}.thumb.webp`)).toBe(false)
    expect(mod.states.get(`attachment:${FILE}`)?.state).toBe("removed")
  })

  it("refuses actions that don't fit the item, and made-up items", async () => {
    signIn(ADMIN)
    expect(
      (await act({ target_type: "proposal", target_id: PID, action: "blur", reason: "Not needed" }))
        .status,
    ).toBe(403)
    expect(
      (
        await act({
          target_type: "proposal",
          target_id: PID,
          action: "delete_file",
          reason: "Not needed",
        })
      ).status,
    ).toBe(403)
    const other = "99999999-2222-4222-8222-222222222222"
    expect(
      (await act({ target_type: "proposal", target_id: other, action: "hide", reason: "Spam" }))
        .status,
    ).toBe(404)
  })
})

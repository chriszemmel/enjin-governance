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
  states: new Map<string, { state: string; reason: string; source?: string }>(),
  suspensions: new Map<string, Date | null>(),
  actions: [] as Record<string, unknown>[],
  reports: [] as Record<string, unknown>[],
  closed: [] as unknown[],
  settings: new Map<string, unknown>(),
  notices: [] as Record<string, unknown>[],
  reportCreated: true,
  failSetState: false,
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
  setState: async (a: {
    targetType: string
    targetId: string
    state: string
    reason: string
    source: string
  }) => {
    if (mod.failSetState) throw new Error("db down")
    mod.states.set(`${a.targetType}:${a.targetId}`, {
      state: a.state,
      reason: a.reason,
      source: a.source,
    })
  },
  listStatesForProposal: async () =>
    [...mod.states.entries()].map(([k, v]) => ({
      target_type: k.split(":")[0],
      target_id: k.slice(k.indexOf(":") + 1),
      ...v,
      updated_at: new Date(0),
    })),
  getState: async (t: string, id: string) => mod.states.get(`${t}:${id}`) ?? null,
  insertAction: async (a: Record<string, unknown>) => void mod.actions.push(a),
  insertReport: async (a: Record<string, unknown>) => {
    mod.reports.push(a)
    return mod.reportCreated
  },
  closeReports: async (...a: unknown[]) => void mod.closed.push(a),
  setSuspension: async (key: string, until: Date | null) => void mod.suspensions.set(key, until),
  getSuspension: async () => null,
  getSetting: async (k: string) => mod.settings.get(k) ?? null,
  saveSetting: async (k: string, v: unknown) => void mod.settings.set(k, v),
  scanChecksToday: async () => 12,
  scanUsageThisMonth: async () => [
    {
      model: "claude-haiku-4-5",
      kind: "images",
      checks: 40,
      input_tokens: 92_000,
      output_tokens: 6_000,
    },
  ],
}))
vi.mock("@/lib/moderation/notify", () => ({
  notifyNewReport: async (n: Record<string, unknown>) => void mod.notices.push(n),
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
import { GET as SETTINGS, PUT as SAVE_SETTINGS } from "@/app/api/moderation/settings/route"
import { GET as STATES } from "@/app/api/moderation/state/route"
import { DEFAULT_SCAN_SETTINGS } from "@/lib/moderation/scan-settings"

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
  mod.notices.length = 0
  mod.reportCreated = true
  mod.failSetState = false
  mod.suspensions.clear()
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

  it("notify moderators once, without the reporter or their note", async () => {
    signIn(USER)
    const body = {
      target_type: "attachment",
      target_id: FILE,
      category: "personal_data",
      note: "my neighbour's photo",
    }
    await REPORT(post("https://gov.test/api/moderation/reports", body))
    expect(mod.notices).toEqual([
      {
        targetId: FILE,
        targetType: "attachment",
        category: "personal_data",
        severity: "medium",
        source: "user",
        network: NET,
        referendumIndex: 214,
      },
    ])
    // A repeat report from the same person isn't news.
    mod.reportCreated = false
    await REPORT(post("https://gov.test/api/moderation/reports", body))
    expect(mod.notices).toHaveLength(1)
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

const read = (key: string) =>
  READ(new NextRequest(`https://gov.test/r/${key}`), {
    params: Promise.resolve({ key: key.split("/") }),
  })

describe("serving moderated media", () => {
  it("holds images the automatic check blurred, but serves a moderator's blur", async () => {
    mod.states.set(`attachment:${FILE}`, { state: "blurred", reason: "check", source: "automatic" })
    expect((await read(FILE)).status).toBe(404)
    expect((await read(`${FILE}.thumb.webp`)).status).toBe(404)
    mod.states.set(`attachment:${FILE}`, {
      state: "blurred",
      reason: "sensitive",
      source: "moderator",
    })
    expect((await read(FILE)).status).toBe(200)
  })

  it("checks a file named like a thumbnail under its own key too", async () => {
    const odd = `proposals/${NET}/${PID}/media/ab12cd34-seed.thumb.webp`
    bucketMod.bucket.set(odd, { body: "IMG", contentType: "image/webp" })
    mod.states.set(`attachment:${odd}`, { state: "hidden", reason: "secret", source: "moderator" })
    expect((await read(odd)).status).toBe(404)
  })
})

describe("uploads without a saved draft", () => {
  it("can still be hidden and deleted while the file exists", async () => {
    const orphanId = "55555555-5555-4555-8555-555555555555"
    const orphan = `proposals/${NET}/${orphanId}/media/cd34ab12-flyer.pdf`
    bucketMod.bucket.set(orphan, { body: "PDF", contentType: "application/pdf" })
    signIn(ADMIN)
    expect(
      (
        await act({
          target_type: "attachment",
          target_id: orphan,
          action: "hide",
          reason: "Phishing flyer",
        })
      ).status,
    ).toBe(200)
    expect(mod.actions.at(-1)).toMatchObject({ proposalId: null, network: NET })
    expect(
      (
        await act({
          target_type: "attachment",
          target_id: orphan,
          action: "delete_file",
          reason: "Phishing flyer",
        })
      ).status,
    ).toBe(200)
    expect(bucketMod.bucket.has(orphan)).toBe(false)
    // Made-up keys in an unclaimed folder are still refused.
    const missing = `proposals/${NET}/${orphanId}/media/ef56ab78-nothing.png`
    expect(
      (
        await act({
          target_type: "attachment",
          target_id: missing,
          action: "hide",
          reason: "Not there",
        })
      ).status,
    ).toBe(404)
  })
})

describe("posting pauses", () => {
  it("are stored by public key, whatever address format was given", async () => {
    signIn(ADMIN)
    const res = await act({
      target_type: "user",
      target_id: USER,
      action: "suspend",
      days: 7,
      reason: "Repeated phishing links",
    })
    expect(res.status).toBe(200)
    const [[key, until]] = [...mod.suspensions.entries()]
    expect(key).toBe(`0x${publicKeyOf(USER)}`)
    expect(until!.getTime()).toBeGreaterThan(Date.now())
    signIn(MOD)
    expect(
      (
        await act({
          target_type: "user",
          target_id: USER,
          action: "unsuspend",
          reason: "Appeal accepted",
        })
      ).status,
    ).toBe(403)
  })
})

describe("content-check settings", () => {
  const put = (body: unknown) =>
    SAVE_SETTINGS(
      new NextRequest("https://gov.test/api/moderation/settings", {
        method: "PUT",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    )
  const wanted = { ...DEFAULT_SCAN_SETTINGS, enabled: true, model: "claude-sonnet-5" }

  it("are for admins only", async () => {
    expect((await SETTINGS()).status).toBe(401)
    expect((await put(wanted)).status).toBe(401)
    signIn(MOD)
    expect((await SETTINGS()).status).toBe(403)
    expect((await put(wanted)).status).toBe(403)
    expect(mod.settings.size).toBe(0)
  })

  it("save a valid set, reject anything else, and report usage with its cost", async () => {
    signIn(ADMIN)
    expect((await put({ ...wanted, model: "gpt-9" })).status).toBe(400)
    expect((await put({ ...wanted, dailyLimit: -1 })).status).toBe(400)
    expect((await put({ ...wanted, apiKey: "sk-..." })).status).toBe(400)
    expect((await put(wanted)).status).toBe(200)
    expect(mod.settings.get("content_scan")).toEqual(wanted)

    const res = await SETTINGS()
    const body = (await res.json()) as {
      settings: typeof wanted
      api_key_configured: boolean
      checks_today: number
      month: { cost_usd: number }[]
    }
    expect(body.settings).toEqual(wanted)
    expect(body.checks_today).toBe(12)
    // 92k in at $1 + 6k out at $5 per million tokens.
    expect(body.month[0]!.cost_usd).toBeCloseTo(0.122)
    expect(JSON.stringify(body)).not.toContain("ANTHROPIC")
  })
})

describe("hardening", () => {
  it("refuses reports on files that don't exist", async () => {
    signIn(USER)
    const ghost = `proposals/${NET}/${PID}/media/ffff0000-ghost.png`
    const res = await REPORT(
      post("https://gov.test/api/moderation/reports", {
        target_type: "attachment",
        target_id: ghost,
        category: "secrets",
      }),
    )
    expect(res.status).toBe(404)
    expect(mod.reports).toHaveLength(0)
    expect(mod.notices).toHaveLength(0)
  })

  it("never publishes the automatic check's explanation", async () => {
    mod.states.set(`attachment:${FILE}`, {
      state: "blurred",
      reason: "Photo of a passport for Jane Doe",
      source: "automatic",
    })
    const res = await STATES(
      new NextRequest(`https://gov.test/api/moderation/state?proposal=${PID}`),
    )
    const body = (await res.json()) as { items: { reason: string | null }[] }
    expect(body.items[0]!.reason).toBeNull()
    expect(JSON.stringify(body)).not.toContain("Jane")
  })

  it("keeps a file when its removal can't be recorded", async () => {
    signIn(ADMIN)
    mod.failSetState = true
    const res = await act({
      target_type: "attachment",
      target_id: FILE,
      action: "delete_file",
      reason: "Takedown",
    }).catch(() => null)
    expect(res === null || res.status >= 500).toBe(true)
    expect(bucketMod.bucket.has(FILE)).toBe(true)
  })

  it("serves nothing for dot segments or malformed escapes", async () => {
    mod.states.set(`attachment:${FILE}`, { state: "hidden", reason: "secret", source: "moderator" })
    const [dir, name] = [
      FILE.slice(0, FILE.lastIndexOf("/")),
      FILE.slice(FILE.lastIndexOf("/") + 1),
    ]
    for (const segs of [
      [...dir.split("/"), ".", name],
      [...dir.split("/"), "", name],
      [...dir.split("/"), "%E0%A4%A"],
    ]) {
      const res = await READ(new NextRequest(`https://gov.test/r/${segs.join("/")}`), {
        params: Promise.resolve({ key: segs }),
      })
      expect(res.status).toBe(404)
    }
  })
})

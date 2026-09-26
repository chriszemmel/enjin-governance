/**
 * Comment routes: posting (session, posting pause, length cap, rate limit,
 * the author is always the session), reading (hidden text never leaves the
 * server), editing (author only, 15 minutes, not deleted or hidden, checked
 * again) and soft-deleting (author only). The automatic text check runs
 * after the response and can only queue a report, never hide or refuse a
 * comment. Real route handlers, real role and ownership checks; only I/O
 * (DB, rate-limit store, Anthropic, Telegram) is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import type * as RateLimit from "@/lib/rate-limit"

const ALICE = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const BOB = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const MOD = "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH"

vi.hoisted(() => {
  // Set so the text check is scheduled; the SDK itself is replaced below.
  process.env.ANTHROPIC_API_KEY = "test-key"
  process.env.GOVERNANCE_ADMIN_PUBLIC_KEYS = ""
})

const auth = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
}))
type Comment = {
  id: string
  proposal_id: string
  parent_id: string | null
  user_id: string
  author_address: string
  body_markdown: string
  is_deleted: boolean
  edited_at: Date | null
  created_at: Date
}
const store = vi.hoisted(() => ({ comments: new Map<string, Comment>(), seq: 0 }))
// Work handed to next/server `after`, run by the test once the response is out.
const deferred = vi.hoisted(() => ({ tasks: [] as (() => Promise<void>)[] }))
const ai = vi.hoisted(() => ({ next: null as unknown, texts: [] as string[] }))
const notices = vi.hoisted(() => [] as unknown[])
const rate = vi.hoisted(() => ({
  store: new Map<string, { count: number; resetAt: number }>(),
  calls: [] as { scope: string; identity: string }[],
}))

vi.mock("next/server", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  after: (task: () => Promise<void>) => void deferred.tasks.push(task),
}))
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() {
      throw new Error("no Anthropic API in tests")
    }
  },
}))
vi.mock("@/lib/moderation/scan", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  scanText: async (text: string) => {
    ai.texts.push(text)
    return ai.next
  },
}))
vi.mock("@/lib/moderation/notify", () => ({
  notifyNewReport: async (n: unknown) => void notices.push(n),
}))
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => auth.user }))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof RateLimit>()
  return {
    ...real,
    // The real fixed-window counter over a per-test store: no KV, no network.
    enforceRateLimit: async (a: {
      scope: string
      identity: string
      limit: number
      windowMs: number
    }) => {
      rate.calls.push({ scope: a.scope, identity: a.identity })
      return real.consume(rate.store, `${a.scope}:${a.identity}`, a.limit, a.windowMs, Date.now())
    },
  }
})
// The real module's pure parts (edit window), with its SQL replaced.
vi.mock("@/lib/db/comments", async (orig) => {
  const withAuthor = (c: Comment) => ({
    ...c,
    author_handle: null,
    author_display_name: null,
    author_avatar_url: null,
    author_is_verified: false,
  })
  return {
    ...(await orig<Record<string, unknown>>()),
    createComment: async (a: {
      proposalId: string
      parentId: string | null
      userId: string
      authorAddress: string
      bodyMarkdown: string
    }) => {
      const id = `c0000000-0000-4000-8000-${String(++store.seq).padStart(12, "0")}`
      const row: Comment = {
        id,
        proposal_id: a.proposalId,
        parent_id: a.parentId,
        user_id: a.userId,
        author_address: a.authorAddress,
        body_markdown: a.bodyMarkdown,
        is_deleted: false,
        edited_at: null,
        created_at: new Date(Date.UTC(2026, 0, 1) + store.seq * 1000),
      }
      store.comments.set(id, row)
      return { ...row }
    },
    listCommentsForProposalWithAuthors: async (proposalId: string) =>
      [...store.comments.values()]
        .filter((c) => c.proposal_id === proposalId)
        .sort((x, y) => x.created_at.getTime() - y.created_at.getTime())
        .map(withAuthor),
    getCommentById: async (id: string) => {
      const c = store.comments.get(id)
      return c ? { ...c } : null
    },
    findCommentOwnership: async (id: string) => {
      const c = store.comments.get(id)
      return c ? { userId: c.user_id } : null
    },
    // UPDATE comments SET body_markdown = $3, edited_at = NOW()
    //  WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE AND created_at > now - 15 min
    editComment: async (id: string, userId: string, body: string) => {
      const c = store.comments.get(id)
      if (!c || c.user_id !== userId || c.is_deleted) return null
      if (c.created_at.getTime() <= Date.now() - 15 * 60_000) return null
      Object.assign(c, { body_markdown: body, edited_at: new Date() })
      return { ...c }
    },
    // UPDATE comments SET is_deleted = TRUE ... WHERE id = $1 AND user_id = $2
    softDeleteComment: async (id: string, userId: string) => {
      const c = store.comments.get(id)
      if (!c || c.user_id !== userId) return false
      Object.assign(c, { is_deleted: true, body_markdown: "[deleted]", edited_at: new Date() })
      return true
    },
  }
})
vi.mock("@/lib/db/moderation", async () => await import("./fake-moderation"))
vi.mock("@/lib/db/proposals", async () => await import("./fake-db"))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))

import * as db from "./fake-db"
import * as mod from "./fake-moderation"
import { publicKeyOf } from "@/lib/chain/ss58"
import { resetScanSettingsCache } from "@/lib/moderation/settings-store"
import { DEFAULT_SCAN_SETTINGS } from "@/lib/moderation/scan-settings"
import { GET as LIST, POST } from "@/app/api/proposals/[uuid]/comments/route"
import { DELETE, PATCH as EDIT } from "@/app/api/comments/[id]/route"
import { RATE_LIMITS } from "@/lib/rate-limit"
import { POST as ACT } from "@/app/api/moderation/actions/route"

const NET = "enjin-relay"
const PID = "22222222-2222-4222-8222-222222222222"
const OTHER_PID = "33333333-3333-4333-8333-333333333333"
const MISSING_PID = "99999999-9999-4999-8999-999999999999"

/** The same wallet in the Enjin Matrixchain format. */
const asMatrix = (address: string) => encodeAddress(decodeAddress(address), 1110)
const pk = (address: string) => `0x${publicKeyOf(address)}`

function signIn(address: string, id = `user-${address.slice(0, 6)}`) {
  auth.user = {
    id,
    address,
    handle: null,
    display_name: null,
    avatar_url: null,
    network: NET,
  }
}
const ctx = (uuid: string) => ({ params: Promise.resolve({ uuid }) })
const post = (uuid: string, body: unknown) =>
  POST(
    new NextRequest(`https://gov.test/api/proposals/${uuid}/comments`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    ctx(uuid),
  )
const list = async (uuid = PID) => {
  const res = await LIST(
    new NextRequest(`https://gov.test/api/proposals/${uuid}/comments`),
    ctx(uuid),
  )
  return { res, body: (await res.json()) as { items: Record<string, unknown>[] } }
}
const del = (id: string) =>
  DELETE(new NextRequest(`https://gov.test/api/comments/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  })
const edit = (id: string, body: unknown) =>
  EDIT(
    new NextRequest(`https://gov.test/api/comments/${id}`, {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  )
/** Backdate a stored comment so it was posted `minutes` ago. */
const postedAgo = (id: string, minutes: number) => {
  store.comments.get(id)!.created_at = new Date(Date.now() - minutes * 60_000)
}
const runDeferred = async () => {
  const tasks = deferred.tasks.splice(0)
  for (const t of tasks) await t()
}
const verdict = (decision: "allow" | "review" | "block") => ({
  kind: "verdict",
  verdict: {
    decision,
    severity: "high",
    labels: ["scam_phishing"],
    explanation: "Links to a fake wallet-drainer site.",
  },
})

beforeEach(() => {
  db.reset()
  mod.resetModeration()
  resetScanSettingsCache()
  store.comments.clear()
  store.seq = 0
  deferred.tasks.length = 0
  ai.next = verdict("allow")
  ai.texts.length = 0
  notices.length = 0
  rate.store.clear()
  rate.calls.length = 0
  auth.user = null
  mod.settings.set("content_scan", { ...DEFAULT_SCAN_SETTINGS, enabled: true })
  mod.roles.set(pk(MOD), { role: "moderator", granted_by: null, created_at: new Date(0) })
  for (const id of [PID, OTHER_PID]) {
    db.seedProposal({
      id,
      network: NET,
      proposer_address: ALICE,
      status: "on_chain",
      referendum_index: id === PID ? 214 : 215,
      json_key: `proposals/${NET}/${id}/proposal.json`,
    })
  }
})

describe("posting a comment", () => {
  it("needs a session, a valid proposal id and an existing proposal", async () => {
    expect((await post(PID, { body_markdown: "Hello" })).status).toBe(401)
    expect(rate.calls).toHaveLength(0)
    signIn(BOB)
    expect((await post("not-a-uuid", { body_markdown: "Hello" })).status).toBe(400)
    expect((await post(MISSING_PID, { body_markdown: "Hello" })).status).toBe(404)
    expect(store.comments.size).toBe(0)
  })

  it("only takes comments on published proposals, answering others like a missing one", async () => {
    signIn(BOB)
    for (const [id, status] of [
      ["44444444-4444-4444-8444-444444444444", "draft"],
      ["55555555-5555-4555-8555-555555555555", "cancelled"],
    ] as const) {
      db.seedProposal({
        id,
        network: NET,
        proposer_address: ALICE,
        status,
        json_key: `proposals/${NET}/${id}/proposal.json`,
      })
      const res = await post(id, { body_markdown: "Found your draft" })
      expect(res.status, status).toBe(404)
      expect(await res.json()).toEqual({ ok: false, error: "Proposal not found" })
    }
    expect(store.comments.size).toBe(0)
  })

  it("only accepts a reply to a comment on the same proposal", async () => {
    signIn(BOB)
    const first = (await (await post(PID, { body_markdown: "Question?" })).json()) as {
      comment: { id: string }
    }
    const elsewhere = (await (await post(OTHER_PID, { body_markdown: "Other thread" })).json()) as {
      comment: { id: string }
    }
    expect((await post(PID, { body_markdown: "Answer", parent_id: first.comment.id })).status).toBe(
      200,
    )
    for (const parent_id of [elsewhere.comment.id, "c0000000-0000-4000-8000-999999999999"]) {
      const res = await post(PID, { body_markdown: "Stray reply", parent_id })
      expect(res.status).toBe(400)
    }
    expect(store.comments.size).toBe(3)
  })

  it("is refused while the author's posting is paused, in every address format", async () => {
    // The pause is stored by public key; the author signs in with another prefix.
    mod.suspensions.set(pk(BOB), new Date(Date.now() + 86_400_000))
    signIn(asMatrix(BOB))
    const res = await post(PID, { body_markdown: "Still here" })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/paused/)
    expect(store.comments.size).toBe(0)
    expect(deferred.tasks).toHaveLength(0)
    // An ended pause no longer applies.
    mod.suspensions.set(pk(BOB), new Date(Date.now() - 1000))
    expect((await post(PID, { body_markdown: "Back" })).status).toBe(200)
  })

  it("fails closed when the pause can't be looked up", async () => {
    signIn(BOB)
    mod.faults.suspension = new Error("connection reset")
    expect((await post(PID, { body_markdown: "Hello" })).status).toBe(503)
    expect(store.comments.size).toBe(0)
    // Before the moderation tables exist nobody can be paused.
    mod.faults.suspension = mod.missingTable()
    expect((await post(PID, { body_markdown: "Hello" })).status).toBe(200)
  })

  it("takes 1 to 10,000 characters of text and refuses malformed bodies", async () => {
    signIn(BOB)
    for (const bad of [
      { body_markdown: "" },
      { body_markdown: "x".repeat(10_001) },
      { body_markdown: 42 },
      {},
      { body_markdown: "ok", parent_id: "not-a-uuid" },
      "{not json",
    ]) {
      expect((await post(PID, bad)).status).toBe(400)
    }
    expect(store.comments.size).toBe(0)
    expect((await post(PID, { body_markdown: "x".repeat(10_000) })).status).toBe(200)
    expect(store.comments.size).toBe(1)
  })

  it("is always stamped with the signed-in wallet, whatever the body claims", async () => {
    signIn(BOB, "bob-user-id")
    const res = await post(PID, {
      body_markdown: "My view",
      user_id: "alice-user-id",
      author_address: ALICE,
      is_deleted: true,
      proposal_id: OTHER_PID,
    })
    expect(res.status).toBe(200)
    const [row] = [...store.comments.values()]
    expect(row).toMatchObject({
      user_id: "bob-user-id",
      author_address: BOB,
      proposal_id: PID,
      is_deleted: false,
      body_markdown: "My view",
    })
    const { comment } = (await res.json()) as { comment: Record<string, unknown> }
    expect(comment).toMatchObject({ user_id: "bob-user-id", author_address: BOB })
  })

  it("is rate-limited per account: the 21st comment within a minute is refused", async () => {
    signIn(BOB, "bob-user-id")
    for (let i = 0; i < 20; i += 1) {
      expect((await post(PID, { body_markdown: `Comment ${i}` })).status).toBe(200)
    }
    const res = await post(PID, { body_markdown: "One too many" })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(store.comments.size).toBe(20)
    expect(rate.calls.at(-1)).toEqual({ scope: "comment-create", identity: "bob-user-id" })
    // Someone else still can.
    signIn(ALICE, "alice-user-id")
    expect((await post(PID, { body_markdown: "Mine" })).status).toBe(200)
  })

  it("runs the automatic check after answering; a flag queues a report but never hides", async () => {
    signIn(BOB)
    ai.next = verdict("block")
    const res = await post(PID, { body_markdown: "Claim your airdrop at drainer.example" })
    // Answered and stored before the check has even run.
    expect(res.status).toBe(200)
    expect(ai.texts).toEqual([])
    const { comment } = (await res.json()) as { comment: { id: string } }
    expect(store.comments.has(comment.id)).toBe(true)

    await runDeferred()
    expect(ai.texts).toEqual(["Claim your airdrop at drainer.example"])
    expect(mod.reports).toMatchObject([
      { target_type: "comment", target_id: comment.id, proposal_id: PID, source: "automatic" },
    ])
    expect(notices).toHaveLength(1)
    // Nothing is hidden: no state, and the text is still served.
    expect(mod.states.size).toBe(0)
    const { body } = await list()
    expect(body.items[0]).toMatchObject({
      id: comment.id,
      body_markdown: "Claim your airdrop at drainer.example",
      moderation: null,
    })
  })

  it("posts normally when the check is unavailable or switched off", async () => {
    signIn(BOB)
    ai.next = { kind: "unavailable", reason: "timeout", cause: "outage" }
    expect((await post(PID, { body_markdown: "First" })).status).toBe(200)
    await runDeferred()
    expect(ai.texts).toEqual(["First"])
    expect(mod.reports).toHaveLength(0)

    mod.settings.set("content_scan", { ...DEFAULT_SCAN_SETTINGS, enabled: true, comments: false })
    resetScanSettingsCache()
    ai.next = verdict("block")
    expect((await post(PID, { body_markdown: "Second" })).status).toBe(200)
    await runDeferred()
    expect(ai.texts).toEqual(["First"])
    expect(mod.reports).toHaveLength(0)
    expect(store.comments.size).toBe(2)
  })
})

describe("reading comments", () => {
  async function seedThread() {
    signIn(BOB)
    const ids: Record<string, string> = {}
    for (const name of ["plain", "blurred", "hidden", "removed", "deleted"]) {
      const res = await post(PID, { body_markdown: `secret text of ${name}` })
      ids[name] = ((await res.json()) as { comment: { id: string } }).comment.id
    }
    for (const state of ["blurred", "hidden", "removed"] as const) {
      await mod.setState({
        targetType: "comment",
        targetId: ids[state]!,
        proposalId: PID,
        state,
        reason: `Moderator: ${state}`,
        source: "moderator",
      })
    }
    expect((await del(ids.deleted!)).status).toBe(200)
    auth.user = null
    return ids
  }

  it("never sends the text of hidden, removed or deleted comments; blurred text stays", async () => {
    const ids = await seedThread()
    const { res, body } = await list()
    expect(res.status).toBe(200)
    const byId = new Map(body.items.map((c) => [c.id, c]))
    expect(byId.get(ids.plain!)).toMatchObject({
      body_markdown: "secret text of plain",
      moderation: null,
    })
    expect(byId.get(ids.blurred!)).toMatchObject({
      body_markdown: "secret text of blurred",
      moderation: { state: "blurred", reason: "Moderator: blurred" },
    })
    for (const name of ["hidden", "removed"]) {
      expect(byId.get(ids[name]!)).toMatchObject({
        body_markdown: "",
        moderation: { state: name },
      })
    }
    expect(byId.get(ids.deleted!)).toMatchObject({ body_markdown: "", is_deleted: true })
    const raw = JSON.stringify(body)
    for (const name of ["hidden", "removed", "deleted"]) {
      expect(raw).not.toContain(`secret text of ${name}`)
    }
  })

  it("only lists the proposal's own comments", async () => {
    signIn(BOB)
    await post(PID, { body_markdown: "On 214" })
    await post(OTHER_PID, { body_markdown: "On 215" })
    const { body } = await list(PID)
    expect(body.items.map((c) => c.body_markdown)).toEqual(["On 214"])
    expect((await list("not-a-uuid")).res.status).toBe(400)
  })

  it("shows nothing when moderation state can't be read", async () => {
    await seedThread()
    mod.faults.states = new Error("db down")
    const { res, body } = await list()
    expect(res.status).toBe(503)
    expect(JSON.stringify(body)).not.toContain("secret text")
    // Before the moderation tables exist nothing is moderated.
    mod.faults.states = mod.missingTable()
    expect((await list()).res.status).toBe(200)
  })

  it("applies a moderator's hide on the next read", async () => {
    signIn(BOB)
    const res = await post(PID, { body_markdown: "My seed phrase is ..." })
    const { id } = ((await res.json()) as { comment: { id: string } }).comment
    // Only moderators can hide it.
    const hide = () =>
      ACT(
        new NextRequest("https://gov.test/api/moderation/actions", {
          method: "POST",
          body: JSON.stringify({
            target_type: "comment",
            target_id: id,
            action: "hide",
            reason: "Contains a recovery phrase.",
          }),
          headers: { "content-type": "application/json" },
        }),
      )
    expect((await hide()).status).toBe(403)
    signIn(MOD)
    expect((await hide()).status).toBe(200)
    auth.user = null
    const { body } = await list()
    expect(body.items[0]).toMatchObject({
      id,
      body_markdown: "",
      moderation: { state: "hidden", reason: "Contains a recovery phrase." },
    })
    expect(JSON.stringify(body)).not.toContain("seed phrase")
  })
})

describe("deleting a comment", () => {
  async function bobsComment() {
    signIn(BOB, "bob-user-id")
    const res = await post(PID, { body_markdown: "Bob's words" })
    return ((await res.json()) as { comment: { id: string } }).comment.id
  }

  it("needs a session and a real comment id", async () => {
    const id = await bobsComment()
    auth.user = null
    expect((await del(id)).status).toBe(401)
    signIn(BOB, "bob-user-id")
    expect((await del("not-a-uuid")).status).toBe(400)
    expect((await del(MISSING_PID)).status).toBe(404)
    expect(store.comments.get(id)?.is_deleted).toBe(false)
  })

  it("is for the author only; nobody else can remove the comment", async () => {
    const id = await bobsComment()
    signIn(ALICE, "alice-user-id")
    expect((await del(id)).status).toBe(403)
    // Moderators can't delete someone's comment either; they hide it instead.
    signIn(MOD, "moderator-user-id")
    expect((await del(id)).status).toBe(403)
    expect(store.comments.get(id)).toMatchObject({
      is_deleted: false,
      body_markdown: "Bob's words",
    })
  })

  it("keeps the comment's slot but drops its text", async () => {
    const id = await bobsComment()
    const res = await del(id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(store.comments.get(id)).toMatchObject({ is_deleted: true, body_markdown: "[deleted]" })
    const { body } = await list()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id, is_deleted: true, body_markdown: "" })
  })
})

describe("editing a comment", () => {
  async function bobsComment(text = "Bob's words") {
    signIn(BOB, "bob-user-id")
    const res = await post(PID, { body_markdown: text })
    const { id } = ((await res.json()) as { comment: { id: string } }).comment
    postedAgo(id, 1)
    await runDeferred()
    return id
  }

  it("needs a session, a real comment id and a text body", async () => {
    const id = await bobsComment()
    auth.user = null
    expect((await edit(id, { body_markdown: "New" })).status).toBe(401)
    signIn(BOB, "bob-user-id")
    expect((await edit("not-a-uuid", { body_markdown: "New" })).status).toBe(400)
    expect((await edit(MISSING_PID, { body_markdown: "New" })).status).toBe(404)
    expect(store.comments.get(id)).toMatchObject({ body_markdown: "Bob's words", edited_at: null })
  })

  it("lets the author change the text, marks it edited and returns the new comment", async () => {
    const id = await bobsComment()
    const res = await edit(id, { body_markdown: "Bob's better words" })
    expect(res.status).toBe(200)
    const { comment } = (await res.json()) as { comment: Record<string, unknown> }
    expect(comment).toMatchObject({
      id,
      user_id: "bob-user-id",
      author_address: BOB,
      body_markdown: "Bob's better words",
      is_deleted: false,
      moderation: null,
    })
    expect(comment.edited_at).not.toBeNull()
    const stored = store.comments.get(id)!
    expect(stored.body_markdown).toBe("Bob's better words")
    expect(stored.edited_at).toBeInstanceOf(Date)
    // Readers see the new text and the edit.
    const { body } = await list()
    expect(body.items[0]).toMatchObject({ id, body_markdown: "Bob's better words" })
    expect(body.items[0]!.edited_at).not.toBeNull()
  })

  it("only takes the fields it allows, whatever else the body claims", async () => {
    const id = await bobsComment()
    const res = await edit(id, {
      body_markdown: "Edited",
      user_id: "alice-user-id",
      author_address: ALICE,
      proposal_id: OTHER_PID,
      is_deleted: true,
      created_at: new Date().toISOString(),
    })
    expect(res.status).toBe(200)
    expect(store.comments.get(id)).toMatchObject({
      user_id: "bob-user-id",
      author_address: BOB,
      proposal_id: PID,
      is_deleted: false,
      body_markdown: "Edited",
    })
  })

  it("is for the author only; nobody else, moderators included, can rewrite it", async () => {
    const id = await bobsComment()
    for (const [address, userId] of [
      [ALICE, "alice-user-id"],
      [MOD, "moderator-user-id"],
    ] as const) {
      signIn(address, userId)
      const res = await edit(id, { body_markdown: "Words put in Bob's mouth" })
      expect(res.status, address).toBe(403)
    }
    expect(store.comments.get(id)).toMatchObject({ body_markdown: "Bob's words", edited_at: null })
  })

  it("is open for 15 minutes after posting, then closed", async () => {
    const id = await bobsComment()
    postedAgo(id, 14)
    expect((await edit(id, { body_markdown: "Still in time" })).status).toBe(200)
    postedAgo(id, 15.05)
    const late = await edit(id, { body_markdown: "Too late" })
    expect(late.status).toBe(403)
    expect(((await late.json()) as { error: string }).error).toMatch(/15 minutes/)
    expect(store.comments.get(id)!.body_markdown).toBe("Still in time")
    // Every comment tells the UI until when it can be edited.
    const { body } = await list()
    const created = new Date(body.items[0]!.created_at as string).getTime()
    expect(new Date(body.items[0]!.editable_until as string).getTime() - created).toBe(15 * 60_000)
  })

  it("is refused once the comment is deleted", async () => {
    const id = await bobsComment()
    expect((await del(id)).status).toBe(200)
    const res = await edit(id, { body_markdown: "Back from the dead" })
    expect(res.status).toBe(409)
    expect(store.comments.get(id)).toMatchObject({ is_deleted: true, body_markdown: "[deleted]" })
  })

  it("is refused once moderators hid or removed it, but not when it is only blurred", async () => {
    for (const state of ["hidden", "removed"] as const) {
      const id = await bobsComment(`Text that was ${state}`)
      await mod.setState({
        targetType: "comment",
        targetId: id,
        proposalId: PID,
        state,
        reason: "Moderator decision",
        source: "moderator",
      })
      const res = await edit(id, { body_markdown: "Harmless now, promise" })
      expect(res.status, state).toBe(403)
      expect(((await res.json()) as { error: string }).error).toMatch(/moderators/i)
      expect(store.comments.get(id)!.body_markdown).toBe(`Text that was ${state}`)
    }
    const id = await bobsComment("Sensitive")
    await mod.setState({
      targetType: "comment",
      targetId: id,
      proposalId: PID,
      state: "blurred",
      reason: "Graphic",
      source: "moderator",
    })
    const res = await edit(id, { body_markdown: "Toned down" })
    expect(res.status).toBe(200)
    // The moderators' decision stays on the edited text.
    expect(((await res.json()) as { comment: { moderation: unknown } }).comment.moderation).toEqual(
      {
        state: "blurred",
        reason: "Graphic",
      },
    )
  })

  it("fails closed when the moderation state can't be read", async () => {
    const id = await bobsComment()
    mod.faults.states = new Error("db down")
    expect((await edit(id, { body_markdown: "New" })).status).toBe(503)
    expect(store.comments.get(id)!.body_markdown).toBe("Bob's words")
    // Before the moderation tables exist nothing is moderated.
    mod.faults.states = mod.missingTable()
    expect((await edit(id, { body_markdown: "New" })).status).toBe(200)
  })

  it("is refused while the author's posting is paused, in every address format", async () => {
    const id = await bobsComment()
    mod.suspensions.set(pk(BOB), new Date(Date.now() + 86_400_000))
    signIn(asMatrix(BOB), "bob-user-id")
    const res = await edit(id, { body_markdown: "Sneaking an edit in" })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/paused/)
    expect(store.comments.get(id)!.body_markdown).toBe("Bob's words")
    expect(deferred.tasks).toHaveLength(0)
  })

  it("takes 1 to 10,000 characters, like posting", async () => {
    const id = await bobsComment()
    for (const bad of [
      { body_markdown: "" },
      { body_markdown: "x".repeat(10_001) },
      { body_markdown: 42 },
      {},
      "{not json",
    ]) {
      const res = await edit(id, bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
      expect(((await res.json()) as { error: string }).error).toMatch(/1 to 10,000 characters/)
    }
    expect(store.comments.get(id)!.body_markdown).toBe("Bob's words")
    expect((await edit(id, { body_markdown: "x".repeat(10_000) })).status).toBe(200)
  })

  it("runs the automatic check again on the new text; a flag queues a report, never hides", async () => {
    const id = await bobsComment("Welcome, everyone")
    expect(ai.texts).toEqual(["Welcome, everyone"])
    ai.next = verdict("block")
    const res = await edit(id, { body_markdown: "Claim your airdrop at drainer.example" })
    // Answered and stored before the check has run.
    expect(res.status).toBe(200)
    expect(ai.texts).toEqual(["Welcome, everyone"])
    await runDeferred()
    expect(ai.texts).toEqual(["Welcome, everyone", "Claim your airdrop at drainer.example"])
    expect(mod.reports).toMatchObject([
      { target_type: "comment", target_id: id, proposal_id: PID, source: "automatic" },
    ])
    expect(notices).toHaveLength(1)
    expect(mod.states.size).toBe(0)
  })

  it("changes nothing when the text is the same", async () => {
    const id = await bobsComment()
    const res = await edit(id, { body_markdown: "Bob's words" })
    expect(res.status).toBe(200)
    expect(store.comments.get(id)!.edited_at).toBeNull()
    expect(deferred.tasks).toHaveLength(0)
  })

  it("is rate-limited per account: the 11th edit within 5 minutes is refused", async () => {
    const id = await bobsComment()
    for (let i = 0; i < RATE_LIMITS.commentEdit.limit; i += 1) {
      expect((await edit(id, { body_markdown: `Take ${i}` })).status).toBe(200)
    }
    const res = await edit(id, { body_markdown: "One too many" })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(store.comments.get(id)!.body_markdown).toBe(`Take ${RATE_LIMITS.commentEdit.limit - 1}`)
    expect(rate.calls.at(-1)).toEqual({ scope: "comment-edit", identity: "bob-user-id" })
  })
})

describe("deleting a comment, rate limit", () => {
  it("refuses the 21st delete within a minute", async () => {
    signIn(BOB, "bob-user-id")
    const ids: string[] = []
    for (let i = 0; i < RATE_LIMITS.commentDelete.limit + 1; i += 1) {
      const res = await post(PID, { body_markdown: `Comment ${i}` })
      ids.push(((await res.json()) as { comment: { id: string } }).comment.id)
      // Posting has its own, separate budget.
      rate.store.delete("comment-create:bob-user-id")
    }
    for (const id of ids.slice(0, -1)) expect((await del(id)).status).toBe(200)
    const res = await del(ids.at(-1)!)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(store.comments.get(ids.at(-1)!)!.is_deleted).toBe(false)
    expect(rate.calls.at(-1)).toEqual({ scope: "comment-delete", identity: "bob-user-id" })
  })
})

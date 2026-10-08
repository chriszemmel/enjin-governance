/**
 * Proposal lifecycle and lookup routes: cancel and withdraw are for the
 * proposer only (matched by public key, whatever address format), cancel
 * stops once the proposal is on chain - even if it gets there between the
 * check and the write, or only its envelope did - and the lookups never
 * show someone's unsigned drafts or internal columns. Real route handlers
 * and ownership checks; only I/O (session, DB, bucket, chain) is mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"

const ALICE = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const BOB = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; address: string },
  fail: false,
}))
// The envelopes (url) noted on chain; `down` = the chain can't be read.
const chain = vi.hoisted(() => ({ noted: new Set<string>(), down: false }))

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => {
    if (auth.fail) throw new Error("session store unreachable")
    return auth.user
  },
}))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/db/moderation", async () => await import("./fake-moderation"))
vi.mock("@/lib/db/proposals", async () => await import("./fake-db"))
vi.mock("@/lib/r2/client", () => ({
  isR2Configured: () => true,
  publicAssetBase: () => "https://fake.local/r",
  r2PublicBase: () => "https://pub.r2.dev",
}))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))
vi.mock("@/lib/governance/envelope-status", () => ({
  isEnvelopeOnChain: async (_network: string, url: string) => {
    if (chain.down) throw new Error("rpc down")
    return chain.noted.has(url)
  },
}))

import * as bucketMod from "./fake-bucket"
import * as db from "./fake-db"
import * as mod from "./fake-moderation"
import { publicKeyOf } from "@/lib/chain/ss58"
import { proposalJsonKey, proposalJsonVersionKey } from "@/lib/r2/paths"
import { __resetRateLimitStore, RATE_LIMITS } from "@/lib/rate-limit"
import { POST as CANCEL } from "@/app/api/proposals/[uuid]/cancel/route"
import { POST as WITHDRAW } from "@/app/api/proposals/[uuid]/withdraw/route"
import { GET as BY_INDEX } from "@/app/api/proposals/by-index/[index]/route"
import { POST as BY_INDICES } from "@/app/api/proposals/by-indices/route"
import { GET as BY_PROPOSER } from "@/app/api/proposals/by-proposer/[address]/route"

const NET = "enjin-relay"
const PID = "11111111-1111-4111-8111-111111111111"
const MISSING = "99999999-9999-4999-8999-999999999999"

/** The same wallet in the Enjin Matrixchain format. */
const asMatrix = (address: string) => encodeAddress(decodeAddress(address), 1110)
const signIn = (address: string) => {
  auth.user = { id: `user-${address.slice(0, 6)}`, address }
}
const seed = (over: Partial<db.ProposalRow> & { id: string } = { id: PID }) =>
  db.seedProposal({
    network: NET,
    proposer_address: ALICE,
    json_key: `proposals/${over.network ?? NET}/${over.id}/proposal.json`,
    ...over,
  })
const postTo = (path: string, body?: unknown) =>
  new NextRequest(`https://gov.test${path}`, {
    method: "POST",
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
const ctx = (uuid: string) => ({ params: Promise.resolve({ uuid }) })
const cancel = (id: string, body?: unknown) =>
  CANCEL(postTo(`/api/proposals/${id}/cancel`, body), ctx(id))
const withdraw = (id: string, body?: unknown) =>
  WITHDRAW(postTo(`/api/proposals/${id}/withdraw`, body), ctx(id))
const row = (id = PID) => db.proposals.get(id)!

beforeEach(() => {
  db.reset()
  mod.resetModeration()
  bucketMod.resetBucket()
  chain.noted.clear()
  chain.down = false
  auth.user = null
  auth.fail = false
  // The real limiter, in-process: no shared KV store in tests.
  for (const k of [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]) {
    vi.stubEnv(k, "")
  }
  __resetRateLimitStore()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("cancel", () => {
  it("needs a session, a valid id and an existing proposal", async () => {
    seed({ id: PID })
    expect((await cancel(PID)).status).toBe(401)
    signIn(ALICE)
    expect((await cancel("not-a-uuid")).status).toBe(400)
    expect((await cancel(MISSING)).status).toBe(404)
    expect(row().status).toBe("draft")
  })

  it("is for the proposer only, matched by public key", async () => {
    seed({ id: PID })
    signIn(BOB)
    const res = await cancel(PID, { reason: "Not yours" })
    expect(res.status).toBe(403)
    expect(row()).toMatchObject({ status: "draft", last_error: null })
    // The proposer, signed in with another network's address format.
    signIn(asMatrix(ALICE))
    const ok = await cancel(PID)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, id: PID, status: "cancelled" })
  })

  it("cancels drafts, stuck submissions and failed rows, recording a short reason", async () => {
    signIn(ALICE)
    const statuses = ["draft", "submitted", "failed"] as const
    const ids = statuses.map((_, i) => `1111111${i}-1111-4111-8111-111111111111`)
    statuses.forEach((status, i) => seed({ id: ids[i]!, status }))
    for (const id of ids) {
      expect((await cancel(id, { reason: "Wrong track" })).status).toBe(200)
      expect(row(id)).toMatchObject({ status: "cancelled", last_error: "Wrong track" })
    }
    // No body, or a reason over 200 characters: the default note is kept instead.
    seed({ id: PID })
    expect((await cancel(PID)).status).toBe(200)
    expect(row().last_error).toBe("Marked outdated by proposer")
    seed({ id: PID })
    expect((await cancel(PID, { reason: "x".repeat(201) })).status).toBe(200)
    expect(row().last_error).toBe("Marked outdated by proposer")
  })

  it("refuses once the proposal is on chain", async () => {
    seed({ id: PID, status: "on_chain", referendum_index: 7 })
    signIn(ALICE)
    expect((await cancel(PID)).status).toBe(409)
    expect(row()).toMatchObject({ status: "on_chain", last_error: null })
  })

  it("is rate limited per account: the 21st request in 5 minutes gets 429", async () => {
    signIn(ALICE)
    for (let i = 0; i < RATE_LIMITS.proposalCancel.limit; i += 1) {
      seed({ id: PID })
      expect((await cancel(PID)).status).toBe(200)
    }
    seed({ id: PID })
    const res = await cancel(PID)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(row().status).toBe("draft")
    // Another account still can.
    signIn(BOB)
    seed({ id: PID, proposer_address: BOB })
    expect((await cancel(PID)).status).toBe(200)
  })

  describe("a draft whose batch landed but was never linked", () => {
    const ownKey = proposalJsonKey(NET, PID)
    beforeEach(() => {
      seed({ id: PID, json_key: ownKey })
      bucketMod.bucket.set(ownKey, { body: "CURRENT", contentType: "application/json" })
      signIn(ALICE)
    })

    it("is refused while its envelope is on chain, so it can still be linked", async () => {
      chain.noted.add(row().json_url)
      const res = await cancel(PID)
      expect(res.status).toBe(409)
      expect(((await res.json()) as { error: string }).error).toMatch(/Link it to its referendum/)
      expect(row()).toMatchObject({ status: "draft", last_error: null })
    })

    it("is refused when an older staged version is the one on chain", async () => {
      const older = proposalJsonVersionKey(NET, PID, "a".repeat(64))
      bucketMod.bucket.set(older, { body: "OLDER", contentType: "application/json" })
      chain.noted.add(`https://fake.local/r/${older}`)
      expect((await cancel(PID)).status).toBe(409)
      expect(row().status).toBe("draft")
    })

    it("fails closed when the chain can't be read", async () => {
      chain.down = true
      expect((await cancel(PID)).status).toBe(503)
      expect(row()).toMatchObject({ status: "draft", last_error: null })
    })

    it("cancels once no version is on chain", async () => {
      expect((await cancel(PID)).status).toBe(200)
      expect(row().status).toBe("cancelled")
    })
  })

  it("refuses when the proposal reaches the chain between the check and the write", async () => {
    seed({ id: PID, status: "submitted" })
    signIn(ALICE)
    db.hooks.afterRead = (id) => {
      Object.assign(db.proposals.get(id)!, { status: "on_chain", referendum_index: 7 })
    }
    expect((await cancel(PID)).status).toBe(409)
    expect(row()).toMatchObject({ status: "on_chain", referendum_index: 7, last_error: null })
  })
})

describe("withdraw", () => {
  beforeEach(() => {
    seed({ id: PID, status: "on_chain", referendum_index: 7 })
  })

  it("needs a session, a valid id and an existing proposal", async () => {
    expect((await withdraw(PID)).status).toBe(401)
    signIn(ALICE)
    expect((await withdraw("not-a-uuid")).status).toBe(400)
    expect((await withdraw(MISSING)).status).toBe(404)
    expect(row().withdrawn_at).toBeNull()
  })

  it("is for the proposer only", async () => {
    signIn(BOB)
    expect((await withdraw(PID, { reason: "Vote nay" })).status).toBe(403)
    expect(row()).toMatchObject({ withdrawn_at: null, withdrawn_reason: null })
    // Nor can someone else clear the proposer's withdrawal.
    signIn(ALICE)
    expect((await withdraw(PID, { reason: "Filed by mistake" })).status).toBe(200)
    signIn(BOB)
    expect((await withdraw(PID, { undo: true })).status).toBe(403)
    expect(row().withdrawn_reason).toBe("Filed by mistake")
  })

  it("is refused while the proposer's posting is paused", async () => {
    mod.suspensions.set(`0x${publicKeyOf(ALICE)}`, new Date(Date.now() + 86_400_000))
    signIn(asMatrix(ALICE))
    const res = await withdraw(PID, { reason: "Banner text" })
    expect(res.status).toBe(403)
    expect(row().withdrawn_at).toBeNull()
  })

  it("lets the proposer flag and clear it, with a trimmed reason of at most 280 characters", async () => {
    signIn(asMatrix(ALICE))
    const res = await withdraw(PID, { reason: "  Filed on the wrong network.  " })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { withdrawn_at: string | null; withdrawn_reason: string }
    expect(body.withdrawn_at).not.toBeNull()
    expect(body.withdrawn_reason).toBe("Filed on the wrong network.")
    expect(row().withdrawn_reason).toBe("Filed on the wrong network.")

    expect((await withdraw(PID, { undo: true })).status).toBe(200)
    expect(row()).toMatchObject({ withdrawn_at: null, withdrawn_reason: null })

    // A blank reason is stored as none; an over-long one is never stored.
    await withdraw(PID, { reason: "   " })
    expect(row().withdrawn_reason).toBeNull()
    const long = "y".repeat(281)
    await withdraw(PID, { reason: long })
    expect(row().withdrawn_reason).not.toBe(long)
    // The on-chain status itself is never touched.
    expect(row().status).toBe("on_chain")
  })

  // Read as empty, a failed undo would withdraw again instead of clearing.
  it("never turns an invalid undo request into a withdrawal", async () => {
    signIn(ALICE)
    expect((await withdraw(PID, { reason: "Filed by mistake" })).status).toBe(200)
    const before = row().withdrawn_at
    expect((await withdraw(PID, { undo: true, reason: "z".repeat(281) })).status).toBe(400)
    expect((await withdraw(PID, "{not json")).status).toBe(400)
    expect(row()).toMatchObject({ withdrawn_at: before, withdrawn_reason: "Filed by mistake" })
  })

  it("is rate limited per account: the 11th request in 5 minutes gets 429", async () => {
    signIn(ALICE)
    for (let i = 0; i < RATE_LIMITS.proposalWithdraw.limit; i += 1) {
      expect((await withdraw(PID, i % 2 ? { undo: true } : { reason: "Vote nay" })).status).toBe(
        200,
      )
    }
    const res = await withdraw(PID, { reason: "Once more" })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(row().withdrawn_at).toBeNull()
  })

  it("only marks published proposals, but always lets a flag be cleared", async () => {
    signIn(ALICE)
    for (const status of ["draft", "submitted", "cancelled", "failed"] as const) {
      const id = "66666666-6666-4666-8666-666666666666"
      db.proposals.delete(id)
      seed({ id, status })
      expect((await withdraw(id, { reason: "Vote nay" })).status, status).toBe(409)
      expect(row(id).withdrawn_at).toBeNull()
    }
    const legacy = "77777777-7777-4777-8777-777777777777"
    seed({ id: legacy, status: "draft" })
    Object.assign(row(legacy), { withdrawn_at: new Date(), withdrawn_reason: "old" })
    expect((await withdraw(legacy, { undo: true })).status).toBe(200)
    expect(row(legacy)).toMatchObject({ withdrawn_at: null, withdrawn_reason: null })
  })
})

describe("by-index", () => {
  const get = (index: string, network: string | null = NET) =>
    BY_INDEX(
      new NextRequest(
        `https://gov.test/api/proposals/by-index/${index}${network ? `?network=${network}` : ""}`,
      ),
      { params: Promise.resolve({ index }) },
    )

  it("validates the index and the network", async () => {
    for (const bad of ["-1", "1.5", "abc"]) expect((await get(bad)).status).toBe(400)
    expect((await get("7", null)).status).toBe(400)
    expect((await get("7", "polkadot")).status).toBe(400)
  })

  it("returns that network's row only, without internal columns", async () => {
    seed({
      id: PID,
      status: "on_chain",
      referendum_index: 7,
      title: "Relay 7",
      proposer_user_id: "internal-user-uuid",
      remark_payload: "EGOV1:...",
      last_error: "internal note",
    })
    seed({
      id: "22222222-2222-4222-8222-222222222222",
      network: "canary-relay",
      status: "on_chain",
      referendum_index: 7,
      title: "Canary 7",
    })
    const res = await get("7")
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-cache, must-revalidate")
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ ok: true, id: PID, title: "Relay 7", network: NET })
    expect(Object.keys(body).sort()).toEqual(PUBLIC_FIELDS)
    expect((await get("8")).status).toBe(404)
  })
})

/** What the lookups show of a proposal (plus `ok` on by-index). */
const PUBLIC_FIELDS = [
  "amount_planck",
  "beneficiary",
  "block_number",
  "body_markdown",
  "created_at",
  "edit_count",
  "edited_at",
  "id",
  "json_sha256",
  "json_url",
  "network",
  "ok",
  "proposer_address",
  "referendum_index",
  "status",
  "summary",
  "title",
  "track",
  "tx_hash",
  "withdrawn_at",
  "withdrawn_reason",
]

describe("by-indices", () => {
  const batch = (body: unknown) => BY_INDICES(postTo("/api/proposals/by-indices", body))

  it("takes at most 500 whole, non-negative indices for a known network", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => i)
    for (const bad of [
      { network: NET, indices: tooMany },
      { network: NET, indices: [] },
      { network: NET, indices: [-1] },
      { network: NET, indices: [1.5] },
      { network: NET, indices: ["7"] },
      { network: NET, indices: 7 },
      { network: "polkadot", indices: [7] },
      { indices: [7] },
      "{not json",
    ]) {
      expect((await batch(bad)).status).toBe(400)
    }
    // Refused before any query is made.
    expect(db.calls.byIndices).toEqual([])
    expect((await batch({ network: NET, indices: tooMany.slice(0, 500) })).status).toBe(200)
  })

  it("queries each index once and returns only that network's rows", async () => {
    seed({ id: PID, status: "on_chain", referendum_index: 7, proposer_user_id: "internal" })
    seed({
      id: "22222222-2222-4222-8222-222222222222",
      network: "canary-relay",
      status: "on_chain",
      referendum_index: 8,
    })
    const res = await batch({ network: NET, indices: [7, 7, 8, 7] })
    expect(res.status).toBe(200)
    expect(db.calls.byIndices).toEqual([{ network: NET, indices: [7, 8] }])
    const body = (await res.json()) as { proposals: Record<string, unknown>[] }
    expect(body.proposals.map((p) => p.id)).toEqual([PID])
    expect(Object.keys(body.proposals[0]!).sort()).toEqual(PUBLIC_FIELDS.filter((f) => f !== "ok"))
  })
})

describe("by-proposer", () => {
  const list = async (address: string, network: string | null = NET) => {
    const res = await BY_PROPOSER(
      new NextRequest(
        `https://gov.test/api/proposals/by-proposer/${address}${network ? `?network=${network}` : ""}`,
      ),
      { params: Promise.resolve({ address }) },
    )
    return {
      res,
      items: res.ok ? ((await res.json()) as { items: Record<string, unknown>[] }).items : [],
    }
  }
  const statuses = ["draft", "submitted", "failed", "cancelled", "on_chain"] as const
  beforeEach(() => {
    statuses.forEach((status, i) =>
      seed({
        id: `4444444${i}-4444-4444-8444-444444444444`,
        status,
        referendum_index: status === "on_chain" ? 9 : null,
        title: `Alice ${status}`,
        body_markdown: "private body",
        remark_payload: "EGOV1:...",
      }),
    )
  })
  const titles = (items: Record<string, unknown>[]) => items.map((i) => i.title).sort()

  it("validates the address and the network", async () => {
    expect((await list("abc")).res.status).toBe(400)
    expect((await list(ALICE, null)).res.status).toBe(400)
    expect((await list(ALICE, "polkadot")).res.status).toBe(400)
  })

  it("shows unsigned drafts only to their proposer; everyone else sees what reached the chain", async () => {
    expect(titles((await list(ALICE)).items)).toEqual(["Alice on_chain"])
    signIn(BOB)
    expect(titles((await list(ALICE)).items)).toEqual(["Alice on_chain"])
    // The proposer, signed in with another network's format of the same key.
    signIn(asMatrix(ALICE))
    expect(titles((await list(ALICE)).items)).toEqual(statuses.map((s) => `Alice ${s}`).sort())
  })

  it("treats a failed session lookup as signed out", async () => {
    auth.fail = true
    const { res, items } = await list(ALICE)
    expect(res.status).toBe(200)
    expect(titles(items)).toEqual(["Alice on_chain"])
  })

  it("lists only summary fields, never the body or the remark", async () => {
    signIn(ALICE)
    const { items } = await list(ALICE)
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([
        "created_at",
        "id",
        "is_treasury",
        "json_url",
        "referendum_index",
        "status",
        "title",
        "tx_hash",
      ])
    }
  })
})

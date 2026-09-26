/**
 * Regression tests for the draft / delete / edit route hardening. The REAL
 * route handlers run; only I/O (auth, DB, bucket, rate limit, RPC) is mocked,
 * and lib/chain/ss58 stays real so ownership checks are genuine.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"

const VICTIM = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const ATTACKER = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"

const auth = vi.hoisted(() => ({ user: null as null | { id: string; address: string } }))
// "anchored" = the draft's envelope is already on chain; "down" = RPC unreachable.
const chainState = vi.hoisted(() => ({ mode: "free" as "free" | "anchored" | "down" }))

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => auth.user }))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getSql: () => {
    throw new Error("getSql must not be called in these tests")
  },
}))
vi.mock("@/lib/r2/client", () => ({
  isR2Configured: () => true,
  r2Bucket: () => "enjin-governance",
  publicAssetBase: () => "https://fake.local/r",
}))
vi.mock("@/lib/db/users", () => ({
  upsertUserByAddress: async (address: string) => ({
    id: address === VICTIM ? "victim-user-id" : "attacker-user-id",
    address,
  }),
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: async () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 60000, retryAfterSeconds: 0 }),
  RATE_LIMITS: { proposalDraft: { scope: "proposal-draft", limit: 10, windowMs: 60_000 } },
}))
vi.mock("@/lib/chain/api", () => ({
  getApi: async () => {
    throw new Error("no RPC in tests")
  },
}))
vi.mock("@/lib/governance/envelope-status", () => ({
  isEnvelopeOnChain: async () => {
    if (chainState.mode === "down") throw new Error("rpc down")
    return chainState.mode === "anchored"
  },
}))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))
vi.mock("@/lib/db/proposals", async () => await import("./fake-db"))

import * as bucketMod from "./fake-bucket"
import * as db from "./fake-db"
import { proposalJsonKey, proposalIndexRedirectKey, userAvatarKey } from "@/lib/r2/paths"
import { POST } from "@/app/api/proposals/draft/route"
import { DELETE, PATCH } from "@/app/api/proposals/[uuid]/route"

const NET = "enjin-relay"
const VICTIM_ID = "11111111-1111-4111-8111-111111111111"
const OWN_ID = "22222222-2222-4222-8222-222222222222"
const OWN_ONCHAIN_ID = "33333333-3333-4333-8333-333333333333"

const victimJsonKey = proposalJsonKey(NET, VICTIM_ID)
const avatarKey = userAvatarKey("99999999-9999-4999-8999-999999999999")
const indexKey = proposalIndexRedirectKey(NET, 42)

function draftBody(over: Record<string, unknown>) {
  return {
    proposal_id: OWN_ID,
    network: NET,
    proposer_address: ATTACKER,
    title: "My title",
    summary: null,
    body_markdown: "my body",
    track: null,
    beneficiary: null,
    amount_planck: null,
    preimage_hash: null,
    preimage_len: null,
    attachments: [],
    ...over,
  }
}
function att(bucket_key: string, name = "x.png") {
  return { bucket_key, name, url: "https://fake.local/r/" + bucket_key, sha256: "a".repeat(64), content_type: "image/png", size_bytes: 100 }
}
function req(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}
const ctx = (uuid: string) => ({ params: Promise.resolve({ uuid }) })
const bodyOf = (k: string) => bucketMod.bucket.get(k)?.body

beforeEach(() => {
  db.reset()
  bucketMod.resetBucket()
  auth.user = { id: "attacker-user-id", address: ATTACKER }
  chainState.mode = "free"
  db.seedProposal({ id: VICTIM_ID, network: NET, proposer_address: VICTIM, status: "on_chain", referendum_index: 42, json_key: victimJsonKey })
  for (const k of [victimJsonKey, avatarKey, indexKey]) bucketMod.bucket.set(k, { body: `REAL:${k}`, contentType: "x" })
})

describe("draft POST", () => {
  it("refuses someone else's proposal id before writing anything", async () => {
    const res = await POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ proposal_id: VICTIM_ID })))
    expect(res.status).toBe(403)
    expect(bodyOf(victimJsonKey)).toBe(`REAL:${victimJsonKey}`)
    expect(db.proposals.size).toBe(1)
  })

  it("re-stages the caller's own draft in place when it sends the current hash", async () => {
    const ownKey = proposalJsonKey(NET, OWN_ID)
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: ownKey, json_sha256: "b".repeat(64) })
    bucketMod.bucket.set(ownKey, { body: "SAVED", contentType: "application/json" })
    const res = await POST(
      req("https://gov.test/api/proposals/draft", "POST", draftBody({ title: "Changed title", expected_sha256: "b".repeat(64) })),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.updated).toBe(true)
    expect(JSON.parse(bodyOf(ownKey)!).title).toBe("Changed title")
    expect(db.proposals.get(OWN_ID)!.title).toBe("Changed title")
    expect(db.proposals.get(OWN_ID)!.json_sha256).toBe(json.json_sha256)
    expect(db.proposals.size).toBe(2)
  })

  it("refuses to re-stage from a stale hash, a submitted row, an anchored envelope or without the chain", async () => {
    const ownKey = proposalJsonKey(NET, OWN_ID)
    const seed = (status: "draft" | "on_chain") =>
      db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status, json_key: ownKey, json_sha256: "b".repeat(64) })
    bucketMod.bucket.set(ownKey, { body: "SAVED", contentType: "application/json" })
    const post = (sha: string) =>
      POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ expected_sha256: sha })))

    seed("draft")
    expect((await post("c".repeat(64))).status).toBe(409) // stale
    seed("on_chain")
    expect((await post("b".repeat(64))).status).toBe(409) // no longer a draft
    seed("draft")
    chainState.mode = "anchored"
    expect((await post("b".repeat(64))).status).toBe(409) // envelope already on chain
    chainState.mode = "down"
    expect((await post("b".repeat(64))).status).toBe(503) // fail closed
    expect(bodyOf(ownKey)).toBe("SAVED")
  })

  it("answers 409 for the caller's own already-saved draft without rewriting it", async () => {
    const ownKey = proposalJsonKey(NET, OWN_ID)
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: ownKey })
    bucketMod.bucket.set(ownKey, { body: "SAVED", contentType: "application/json" })
    const res = await POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({})))
    expect(res.status).toBe(409)
    expect(bodyOf(ownKey)).toBe("SAVED")
  })

  it("rejects attachment keys outside the proposal's own media folder, writing nothing", async () => {
    for (const foreign of [victimJsonKey, avatarKey, indexKey, `proposals/${NET}/${VICTIM_ID}/media/a.png`]) {
      const res = await POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ attachments: [att(foreign)] })))
      expect(res.status).toBe(400)
    }
    expect(bucketMod.bucket.has(proposalJsonKey(NET, OWN_ID))).toBe(false)
    expect(db.proposals.size).toBe(1)
  })

  it("rejects a beneficiary in another network's format", async () => {
    // A valid Enjin Matrixchain address (prefix 1110), not Enjin Relay.
    const matrix = "efRKnRAsiKi8pHp1LvbvokibcYgcdYMAQFRPgGZKarNzq7dB5"
    const res = await POST(
      req("https://gov.test/api/proposals/draft", "POST", draftBody({ beneficiary: matrix, amount_planck: "1" })),
    )
    expect(res.status).toBe(400)
    expect(bucketMod.bucket.has(proposalJsonKey(NET, OWN_ID))).toBe(false)
  })

  it("still saves a normal draft with its own attachment", async () => {
    const mediaKey = `proposals/${NET}/${OWN_ID}/media/roadmap.png`
    const res = await POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ attachments: [att(mediaKey, "roadmap.png")] })))
    expect(res.status).toBe(200)
    expect(db.attachments.map((a) => a.bucket_key)).toContain(mediaKey)
  })
})

describe("DELETE", () => {
  it("only deletes objects inside the draft's own folder, even if foreign rows exist", async () => {
    const ownKey = proposalJsonKey(NET, OWN_ID)
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: ownKey })
    bucketMod.bucket.set(ownKey, { body: "OWN", contentType: "application/json" })
    // Rows a pre-fix server could have stored:
    db.seedAttachment({ proposal_id: OWN_ID, bucket_key: victimJsonKey })
    db.seedAttachment({ proposal_id: OWN_ID, bucket_key: avatarKey })
    const res = await DELETE(req(`https://gov.test/api/proposals/${OWN_ID}`, "DELETE"), ctx(OWN_ID))
    expect(res.status).toBe(200)
    expect(bucketMod.bucket.has(ownKey)).toBe(false)
    expect(bodyOf(victimJsonKey)).toBe(`REAL:${victimJsonKey}`)
    expect(bodyOf(avatarKey)).toBe(`REAL:${avatarKey}`)
  })

  it("still refuses to delete someone else's draft", async () => {
    const res = await DELETE(req(`https://gov.test/api/proposals/${VICTIM_ID}`, "DELETE"), ctx(VICTIM_ID))
    expect(res.status).toBe(403)
  })
})

describe("PATCH (edit)", () => {
  beforeEach(() => {
    db.seedProposal({ id: OWN_ONCHAIN_ID, network: NET, proposer_address: ATTACKER, status: "on_chain", referendum_index: 7, json_key: proposalJsonKey(NET, OWN_ONCHAIN_ID) })
  })
  const patchBody = (attachments: unknown[]) => ({ title: "Edited", summary: null, body_markdown: "b", attachments })

  it("rejects a foreign attachment key", async () => {
    const res = await PATCH(req(`https://gov.test/api/proposals/${OWN_ONCHAIN_ID}`, "PATCH", patchBody([att(victimJsonKey)])), ctx(OWN_ONCHAIN_ID))
    expect(res.status).toBe(400)
  })

  it("accepts the edit page's r/-prefixed key and stores the real key", async () => {
    const real = `proposals/${NET}/${OWN_ONCHAIN_ID}/media/pic.png`
    const res = await PATCH(req(`https://gov.test/api/proposals/${OWN_ONCHAIN_ID}`, "PATCH", patchBody([att(`r/${real}`, "pic.png")])), ctx(OWN_ONCHAIN_ID))
    expect(res.status).toBe(200)
    expect(db.attachments.filter((a) => a.proposal_id === OWN_ONCHAIN_ID).map((a) => a.bucket_key)).toEqual([real])
  })
})

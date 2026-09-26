/**
 * Regression tests for the draft / delete / edit route hardening. The REAL
 * route handlers run; only I/O (auth, DB, bucket, rate limit, RPC) is mocked,
 * and lib/chain/ss58 stays real so ownership checks are genuine.
 */
import { createHash } from "node:crypto"
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
  r2PublicBase: () => "https://pub.r2.dev",
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
const modLog = vi.hoisted(() => ({ states: [] as unknown[], actions: [] as unknown[] }))
vi.mock("@/lib/db/moderation", () => ({
  setState: async (a: unknown) => void modLog.states.push(a),
  insertAction: async (a: unknown) => void modLog.actions.push(a),
  listStatesForProposal: async () => [],
  getState: async () => null,
  closeReports: async () => undefined,
  getSuspension: async () => null,
}))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))
vi.mock("@/lib/db/proposals", async () => await import("./fake-db"))

import * as bucketMod from "./fake-bucket"
import * as db from "./fake-db"
import { proposalJsonKey, proposalIndexRedirectKey, userAvatarKey } from "@/lib/r2/paths"
import { POST } from "@/app/api/proposals/draft/route"
import { DELETE, PATCH } from "@/app/api/proposals/[uuid]/route"
import { DELETE as MEDIA_DELETE } from "@/app/api/proposals/[uuid]/media/route"
import { GET as JSON_GET } from "@/app/api/proposals/[uuid]/json/route"

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
/** An attachment as the upload route described it: the stored file's own details. */
function att(bucket_key: string, name = "x.png") {
  const stored = bucketMod.bucket.get(bucket_key.replace(/^r\//, ""))
  if (!stored) {
    return { bucket_key, name, url: "https://fake.local/r/" + bucket_key, sha256: "a".repeat(64), content_type: "image/png", size_bytes: 100 }
  }
  const body = Buffer.from(stored.body, "utf8")
  return { bucket_key, name, url: "https://fake.local/r/" + bucket_key, sha256: bucketMod.sha256Hex(stored.body), content_type: stored.contentType, size_bytes: body.length }
}
/** Store an uploaded image, as the media route would. */
const upload = (key: string, body = "IMG") => bucketMod.bucket.set(key, { body, contentType: "image/png" })
function req(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}
const ctx = (uuid: string) => ({ params: Promise.resolve({ uuid }) })
const bodyOf = (k: string) => bucketMod.bucket.get(k)?.body
/** Everything stored in a proposal's folder. */
const folderKeys = (id: string) =>
  [...bucketMod.bucket.keys()].filter((k) => k.startsWith(`proposals/${NET}/${id}/`))
/** The JSON version the row currently points at. */
const savedJson = (id: string) => JSON.parse(bodyOf(db.proposals.get(id)!.json_key)!)

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

  it("re-stages the caller's own draft as a new version and keeps the old bytes", async () => {
    const ownKey = proposalJsonKey(NET, OWN_ID)
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: ownKey, json_sha256: "b".repeat(64) })
    bucketMod.bucket.set(ownKey, { body: "SAVED", contentType: "application/json" })
    const res = await POST(
      req("https://gov.test/api/proposals/draft", "POST", draftBody({ title: "Changed title", expected_sha256: "b".repeat(64) })),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.updated).toBe(true)
    const row = db.proposals.get(OWN_ID)!
    expect(row.json_key).toBe(`proposals/${NET}/${OWN_ID}/proposal-${json.json_sha256.slice(0, 16)}.json`)
    expect(row.json_url).toBe(json.json_url)
    expect(savedJson(OWN_ID).title).toBe("Changed title")
    expect(row.title).toBe("Changed title")
    expect(row.json_sha256).toBe(json.json_sha256)
    // A batch signed from the earlier version still finds its bytes.
    expect(bodyOf(ownKey)).toBe("SAVED")
    expect(db.proposals.size).toBe(2)

    // Staging the same content again writes nothing new.
    const again = await POST(
      req("https://gov.test/api/proposals/draft", "POST", draftBody({ title: "Changed title", expected_sha256: json.json_sha256 })),
    )
    expect(again.status).toBe(200)
    expect((await again.json()).json_sha256).toBe(json.json_sha256)
    expect(folderKeys(OWN_ID)).toHaveLength(2)
  })

  it("never lets a losing concurrent re-stage replace the winner's bytes", async () => {
    const ownKey = proposalJsonKey(NET, OWN_ID)
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: ownKey, json_sha256: "b".repeat(64) })
    bucketMod.bucket.set(ownKey, { body: "SAVED", contentType: "application/json" })
    const stage = (title: string) =>
      POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ title, expected_sha256: "b".repeat(64) })))
    const [a, b] = await Promise.all([stage("Tab A"), stage("Tab B")])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const winner = (await (a.status === 200 ? a : b).json()) as { json_sha256: string; remark_payload: string }
    const row = db.proposals.get(OWN_ID)!
    // The row, its bytes and the returned envelope all agree.
    expect(row.json_sha256).toBe(winner.json_sha256)
    expect(createHash("sha256").update(bodyOf(row.json_key)!).digest("hex")).toBe(winner.json_sha256)
    expect(winner.remark_payload).toContain(winner.json_sha256)
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
    expect(folderKeys(OWN_ID)).toEqual([])
    expect(db.proposals.size).toBe(1)
  })

  it("rejects a beneficiary in another network's format", async () => {
    // A valid Enjin Matrixchain address (prefix 1110), not Enjin Relay.
    const matrix = "efRKnRAsiKi8pHp1LvbvokibcYgcdYMAQFRPgGZKarNzq7dB5"
    const res = await POST(
      req("https://gov.test/api/proposals/draft", "POST", draftBody({ beneficiary: matrix, amount_planck: "1" })),
    )
    expect(res.status).toBe(400)
    expect(folderKeys(OWN_ID)).toEqual([])
  })

  it("writes EGOV1 1.2.0 with the call section, and only when it matches the preimage", async () => {
    const hash = "0x" + "e".repeat(64)
    const call = { section: "referenda", method: "cancel", origin: "ReferendumCanceller", preimage_hash: hash, preimage_len: 7, inline: true }
    const base = { preimage_hash: hash, preimage_len: 7, track: "ReferendumCanceller", enactment: { type: "After", block: 0 } }
    const bad = await POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ ...base, call: { ...call, preimage_len: 8 } })))
    expect(bad.status).toBe(400)
    const ok = await POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ ...base, call })))
    expect(ok.status).toBe(200)
    const saved = savedJson(OWN_ID)
    expect(saved).toMatchObject({ version: "1.2.0", call, enactment: { type: "After", block: 0 } })
  })

  it("still writes 1.1.0 for treasury drafts without a call section", async () => {
    const res = await POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({})))
    expect(res.status).toBe(200)
    const saved = savedJson(OWN_ID)
    expect(saved.version).toBe("1.1.0")
    expect("call" in saved).toBe(false)
  })

  it("still saves a normal draft with its own attachment", async () => {
    const mediaKey = `proposals/${NET}/${OWN_ID}/media/roadmap.png`
    upload(mediaKey)
    const res = await POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ attachments: [att(mediaKey, "roadmap.png")] })))
    expect(res.status).toBe(200)
    expect(db.attachments.map((a) => a.bucket_key)).toContain(mediaKey)
  })

  it("writes attachment URLs built from the key, never the browser's URL", async () => {
    const mediaKey = `proposals/${NET}/${OWN_ID}/media/ab12cd34-roadmap.png`
    upload(mediaKey)
    const sneaky = { ...att(mediaKey, "roadmap.png"), url: "https://tracker.example/pixel.png" }
    const res = await POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ attachments: [sneaky] })))
    expect(res.status).toBe(200)
    const saved = savedJson(OWN_ID)
    expect(saved.attachments[0].url).toBe(`https://fake.local/r/${mediaKey}`)
    expect(db.attachments.find((a) => a.bucket_key === mediaKey)?.url).toBe(`https://fake.local/r/${mediaKey}`)
  })

  it("re-staging without an attachment keeps its file for earlier versions; deleting the draft removes the folder", async () => {
    const ownKey = proposalJsonKey(NET, OWN_ID)
    const keep = `proposals/${NET}/${OWN_ID}/media/aaaa1111-keep.png`
    const drop = `proposals/${NET}/${OWN_ID}/media/bbbb2222-drop.png`
    const unlisted = `proposals/${NET}/${OWN_ID}/media/cccc3333-held.png`
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: ownKey, json_sha256: "b".repeat(64) })
    db.seedAttachment({ proposal_id: OWN_ID, bucket_key: keep })
    db.seedAttachment({ proposal_id: OWN_ID, bucket_key: drop })
    bucketMod.bucket.set(ownKey, { body: "SAVED", contentType: "application/json" })
    for (const k of [keep, drop, `${drop}.thumb.webp`, unlisted]) bucketMod.bucket.set(k, { body: "IMG", contentType: "image/png" })
    const res = await POST(
      req("https://gov.test/api/proposals/draft", "POST", draftBody({ attachments: [att(keep, "keep.png")], expected_sha256: "b".repeat(64) })),
    )
    expect(res.status).toBe(200)
    expect(bucketMod.bucket.has(drop)).toBe(true)
    expect(bucketMod.bucket.has(`${drop}.thumb.webp`)).toBe(true)

    const del = await DELETE(req(`https://gov.test/api/proposals/${OWN_ID}`, "DELETE"), ctx(OWN_ID))
    expect(del.status).toBe(200)
    // Every version, every upload - listed or held - is gone.
    expect(folderKeys(OWN_ID)).toEqual([])
    expect(bodyOf(victimJsonKey)).toBe(`REAL:${victimJsonKey}`)
  })

  it("refuses to delete a draft that is pinned on chain, and fails closed", async () => {
    const ownKey = proposalJsonKey(NET, OWN_ID)
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: ownKey, json_sha256: "b".repeat(64) })
    bucketMod.bucket.set(ownKey, { body: "SAVED", contentType: "application/json" })
    const del = () => DELETE(req(`https://gov.test/api/proposals/${OWN_ID}`, "DELETE"), ctx(OWN_ID))
    chainState.mode = "anchored"
    expect((await del()).status).toBe(409)
    chainState.mode = "down"
    expect((await del()).status).toBe(503)
    expect(db.proposals.has(OWN_ID)).toBe(true)
    expect(bodyOf(ownKey)).toBe("SAVED")
  })

  it("only edits proposals that reached the chain", async () => {
    const ownKey = proposalJsonKey(NET, OWN_ID)
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: ownKey, json_sha256: "b".repeat(64) })
    bucketMod.bucket.set(ownKey, { body: "SAVED", contentType: "application/json" })
    const res = await PATCH(
      req(`https://gov.test/api/proposals/${OWN_ID}`, "PATCH", { title: "Edited", summary: null, body_markdown: "x" }),
      ctx(OWN_ID),
    )
    expect(res.status).toBe(409)
    expect(bodyOf(ownKey)).toBe("SAVED")
  })
})

describe("media DELETE", () => {
  const mediaKey = (id: string, name = "cccc3333-pic.png") => `proposals/${NET}/${id}/media/${name}`
  const del = (id: string, key: string) =>
    MEDIA_DELETE(
      req(`https://gov.test/api/proposals/${id}/media?network=${NET}&key=${encodeURIComponent(key)}`, "DELETE"),
      ctx(id),
    )
  const put = (k: string) => bucketMod.bucket.set(k, { body: "IMG", contentType: "image/png" })

  it("removes an upload (and its thumbnail) before the draft exists", async () => {
    const k = mediaKey(OWN_ID)
    put(k)
    put(`${k}.thumb.webp`)
    const res = await del(OWN_ID, k)
    expect(res.status).toBe(200)
    expect((await res.json()).deleted).toBe(true)
    expect(bucketMod.bucket.has(k)).toBe(false)
    expect(bucketMod.bucket.has(`${k}.thumb.webp`)).toBe(false)
  })

  it("keeps a file the saved draft lists", async () => {
    const k = mediaKey(OWN_ID)
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: proposalJsonKey(NET, OWN_ID) })
    db.seedAttachment({ proposal_id: OWN_ID, bucket_key: k })
    put(k)
    const res = await del(OWN_ID, k)
    expect(res.status).toBe(200)
    expect((await res.json()).deleted).toBe(false)
    expect(bucketMod.bucket.has(k)).toBe(true)
  })

  it("keeps a file an older version lists, since the draft can switch back to it", async () => {
    const older = mediaKey(OWN_ID, "aaaa1111-older.png")
    const loose = mediaKey(OWN_ID, "dddd4444-loose.png")
    const current = proposalJsonKey(NET, OWN_ID)
    const olderJson = `proposals/${NET}/${OWN_ID}/proposal-${"1".repeat(16)}.json`
    db.seedProposal({ id: OWN_ID, network: NET, proposer_address: ATTACKER, status: "draft", json_key: current })
    bucketMod.bucket.set(current, { body: JSON.stringify({ attachments: [] }), contentType: "application/json" })
    bucketMod.bucket.set(olderJson, {
      body: JSON.stringify({ attachments: [{ url: `https://pub.r2.dev/${older}` }] }),
      contentType: "application/json",
    })
    put(older)
    put(loose)
    const kept = await del(OWN_ID, older)
    expect(kept.status).toBe(200)
    expect((await kept.json()).deleted).toBe(false)
    expect(bucketMod.bucket.has(older)).toBe(true)
    const gone = await del(OWN_ID, loose)
    expect((await gone.json()).deleted).toBe(true)
    expect(bucketMod.bucket.has(loose)).toBe(false)
  })

  it("never removes files of submitted or foreign proposals, or keys outside the folder", async () => {
    const victimFile = mediaKey(VICTIM_ID)
    put(victimFile)
    expect((await del(VICTIM_ID, victimFile)).status).toBe(403)

    const submittedId = "44444444-4444-4444-8444-444444444444"
    db.seedProposal({ id: submittedId, network: NET, proposer_address: ATTACKER, status: "submitted", json_key: proposalJsonKey(NET, submittedId) })
    const submittedFile = mediaKey(submittedId)
    put(submittedFile)
    expect((await del(submittedId, submittedFile)).status).toBe(409)

    expect((await del(OWN_ID, victimFile)).status).toBe(400)
    expect((await del(OWN_ID, victimJsonKey)).status).toBe(400)
    expect(bucketMod.bucket.has(victimFile)).toBe(true)
    expect(bucketMod.bucket.has(submittedFile)).toBe(true)
    expect(bodyOf(victimJsonKey)).toBe(`REAL:${victimJsonKey}`)
  })

  it("lets the proposer remove their own file from a published proposal, on the record", async () => {
    modLog.states.length = 0
    modLog.actions.length = 0
    db.seedProposal({ id: OWN_ONCHAIN_ID, network: NET, proposer_address: ATTACKER, status: "on_chain", referendum_index: 7, json_key: proposalJsonKey(NET, OWN_ONCHAIN_ID) })
    const jsonKey = proposalJsonKey(NET, OWN_ONCHAIN_ID)
    bucketMod.bucket.set(jsonKey, { body: "PINNED", contentType: "application/json" })
    const k = mediaKey(OWN_ONCHAIN_ID)
    put(k)
    const res = await del(OWN_ONCHAIN_ID, k)
    expect(res.status).toBe(200)
    expect(bucketMod.bucket.has(k)).toBe(false)
    // The JSON (and so its EGOV1 verification) is untouched.
    expect(bodyOf(jsonKey)).toBe("PINNED")
    expect(modLog.states).toMatchObject([{ targetId: k, state: "removed", source: "proposer" }])
    expect(modLog.actions).toMatchObject([{ targetId: k, action: "delete_file", referendumIndex: 7 }])
  })

  it("requires a session", async () => {
    auth.user = null
    expect((await del(OWN_ID, mediaKey(OWN_ID))).status).toBe(401)
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

  it("keeps the EGOV1 1.2.0 call and enactment sections across an edit", async () => {
    const key = proposalJsonKey(NET, OWN_ONCHAIN_ID)
    const call = { section: "system", method: "setCode", origin: "Root", preimage_hash: "0x" + "c".repeat(64), preimage_len: 9000, inline: false, code_hash: "0x" + "d".repeat(64) }
    bucketMod.bucket.set(key, { body: JSON.stringify({ version: "1.2.0", call, enactment: { type: "After", block: 10 } }), contentType: "application/json" })
    const res = await PATCH(req(`https://gov.test/api/proposals/${OWN_ONCHAIN_ID}`, "PATCH", patchBody([])), ctx(OWN_ONCHAIN_ID))
    expect(res.status).toBe(200)
    const saved = JSON.parse(bodyOf(key)!)
    expect(saved).toMatchObject({ version: "1.2.0", title: "Edited", call, enactment: { type: "After", block: 10 } })
  })

  it("accepts the edit page's r/-prefixed key and stores the real key", async () => {
    const real = `proposals/${NET}/${OWN_ONCHAIN_ID}/media/pic.png`
    upload(real)
    const res = await PATCH(req(`https://gov.test/api/proposals/${OWN_ONCHAIN_ID}`, "PATCH", patchBody([att(`r/${real}`, "pic.png")])), ctx(OWN_ONCHAIN_ID))
    expect(res.status).toBe(200)
    expect(db.attachments.filter((a) => a.proposal_id === OWN_ONCHAIN_ID).map((a) => a.bucket_key)).toEqual([real])
  })
})

describe("attachment details", () => {
  const media = (id: string, name: string) => `proposals/${NET}/${id}/media/${name}`
  const stage = (attachments: unknown[], over: Record<string, unknown> = {}) =>
    POST(req("https://gov.test/api/proposals/draft", "POST", draftBody({ attachments, ...over })))
  const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error

  it("refuses size, type or hash the stored file doesn't have, writing nothing", async () => {
    const key = media(OWN_ID, "ab12cd34-chart.png")
    upload(key)
    for (const lie of [{ size_bytes: 99 }, { content_type: "application/pdf" }, { sha256: "f".repeat(64) }]) {
      const res = await stage([{ ...att(key, "chart.png"), ...lie }])
      expect(res.status).toBe(400)
      expect(await errorOf(res)).toContain("don't match the uploaded file")
    }
    expect(folderKeys(OWN_ID)).toEqual([key])
    expect(db.proposals.has(OWN_ID)).toBe(false)
  })

  it("refuses a file that isn't stored, unless the saved version already lists it", async () => {
    const gone = media(OWN_ID, "ab12cd34-gone.png")
    const res = await stage([att(gone, "gone.png")])
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toContain("no longer stored")

    // Saved with the file, which a moderator removed since: re-staging keeps listing it.
    upload(gone)
    const listed = att(gone, "gone.png")
    expect((await stage([listed])).status).toBe(200)
    bucketMod.bucket.delete(gone)
    const again = await stage([listed], { expected_sha256: db.proposals.get(OWN_ID)!.json_sha256 })
    expect(again.status).toBe(200)
    expect(savedJson(OWN_ID).attachments[0]).toMatchObject({ name: "gone.png", sha256: listed.sha256 })
  })

  it("hashes a file stored before hashes were recorded, and trusts the hash a saved version gave it", async () => {
    const old = media(OWN_ID, "ab12cd34-old.png")
    bucketMod.bucket.set(old, { body: "OLD", contentType: "image/png", sha256: null })
    const right = att(old, "old.png")
    expect((await stage([{ ...right, sha256: "f".repeat(64) }])).status).toBe(400)
    expect((await stage([right])).status).toBe(200)
    // Once saved, later saves take that hash instead of downloading the file again.
    bucketMod.bucket.set(old, { body: "NEW", contentType: "image/png", sha256: null })
    expect((await stage([right], { expected_sha256: db.proposals.get(OWN_ID)!.json_sha256 })).status).toBe(200)
  })

  it("cleans names of characters that disguise them", async () => {
    const key = media(OWN_ID, "ab12cd34-invoice.png")
    upload(key)
    expect((await stage([att(key, "invoice\u202Egnp.exe\u0000 ")])).status).toBe(200)
    expect(savedJson(OWN_ID).attachments[0].name).toBe("invoicegnp.exe")
    expect(db.attachments.find((a) => a.bucket_key === key)?.filename).toBe("invoicegnp.exe")
  })

  it("fails closed when storage can't be read", async () => {
    const key = media(OWN_ID, "ab12cd34-chart.png")
    upload(key)
    bucketMod.faults.stat = true
    expect((await stage([att(key)])).status).toBe(503)
    expect(db.proposals.has(OWN_ID)).toBe(false)
  })

  it("lets an edit keep listing a file removed from a published proposal", async () => {
    const key = proposalJsonKey(NET, OWN_ONCHAIN_ID)
    db.seedProposal({ id: OWN_ONCHAIN_ID, network: NET, proposer_address: ATTACKER, status: "on_chain", referendum_index: 7, json_key: key })
    const removed = media(OWN_ONCHAIN_ID, "ab12cd34-removed.png")
    upload(removed)
    const listed = att(removed, "removed.png")
    bucketMod.bucket.delete(removed)
    bucketMod.bucket.set(key, {
      body: JSON.stringify({ attachments: [{ ...listed, url: `https://fake.local/r/${removed}` }] }),
      contentType: "application/json",
    })
    const patch = (attachments: unknown[]) =>
      PATCH(req(`https://gov.test/api/proposals/${OWN_ONCHAIN_ID}`, "PATCH", { title: "Edited", summary: null, body_markdown: "x", attachments }), ctx(OWN_ONCHAIN_ID))
    expect((await patch([listed])).status).toBe(200)
    expect((await patch([{ ...listed, size_bytes: 5 }])).status).toBe(400)
  })
})

describe("proposal JSON", () => {
  it("keeps drafts private to their proposer, and on-chain proposals public", async () => {
    const draftId = "55555555-5555-4555-8555-555555555555"
    db.seedProposal({ id: draftId, network: NET, proposer_address: VICTIM, status: "draft", json_key: proposalJsonKey(NET, draftId) })
    const get = (id: string) => JSON_GET(req(`https://gov.test/api/proposals/${id}/json`, "GET"), ctx(id))
    expect((await get(draftId)).status).toBe(404) // signed in as someone else
    auth.user = null
    expect((await get(draftId)).status).toBe(404) // signed out
    auth.user = { id: "victim-user-id", address: VICTIM }
    expect((await get(draftId)).status).not.toBe(404)
    auth.user = null
    expect((await get(VICTIM_ID)).status).not.toBe(404) // on chain: public
  })
})

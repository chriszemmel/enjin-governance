import { randomUUID } from "node:crypto"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { address, draftFixture, mediaKey, setupTestDb } from "@/test/pglite"

vi.mock("@/lib/db/client", () => import("@/test/pglite").then((m) => m.dbClientMock))

import { initializeWasm } from "@/lib/chain/ss58"
import { createComment, getCommentById } from "@/lib/db/comments"
import {
  attachReferendumIndex,
  deleteProposalById,
  getProposalById,
  getProposalByIndex,
  getProposalsByIndices,
  insertAttachment,
  insertProposalDraft,
  listAttachments,
  listProposalsByProposer,
  listProposalsWithIndex,
  markProposalCancelled,
  markProposalFailed,
  replaceAttachments,
  setProposalWithdrawn,
  updateProposalContent,
  updateProposalDraft,
  type ReplaceAttachmentItem,
  type UpdateProposalDraftArgs,
} from "@/lib/db/proposals"
import { upsertUserByAddress } from "@/lib/db/users"

setupTestDb()
beforeAll(() => initializeWasm())

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)

function restage(id: string, over: Partial<UpdateProposalDraftArgs> = {}): UpdateProposalDraftArgs {
  return {
    id,
    expectedSha256: SHA_A,
    title: "Fund the thing, v2",
    summary: "Shorter",
    bodyMarkdown: "Why it matters, again.",
    track: "treasurer",
    beneficiary: address(9),
    amountPlanck: 10n ** 30n,
    jsonUrl: "https://cdn.example/v2.json",
    jsonKey: "proposals/enjin-relay/x/proposal-bbbbbbbbbbbbbbbb.json",
    jsonSha256: SHA_B,
    preimageHash: "0xabc",
    preimageLen: 42,
    remarkPayload: "EGOV1:v2",
    ...over,
  }
}

const attach = (id: string, referendumIndex: number) =>
  attachReferendumIndex({
    proposalId: id,
    referendumIndex,
    txHash: "0xtx",
    blockHash: "0xblock",
    blockNumber: 5_000_000_000,
  })

const file = (proposalId: string, name: string, size = 100): ReplaceAttachmentItem => ({
  bucketKey: mediaKey(proposalId, name),
  url: `https://cdn.example/${mediaKey(proposalId, name)}`,
  filename: name,
  contentType: "image/png",
  sizeBytes: size,
  sha256: SHA_A,
  uploadedBy: null,
})

describe("insertProposalDraft", () => {
  it("stores a draft and returns the whole row", async () => {
    const user = await upsertUserByAddress(address(1))
    const d = draftFixture({ proposerUserId: user.id, amountPlanck: 12_345_678_901_234_567_890n })
    const row = await insertProposalDraft(d)
    expect(row).toMatchObject({
      id: d.id,
      network: "enjin-relay",
      proposer_user_id: user.id,
      status: "draft",
      referendum_index: null,
      // NUMERIC comes back as a string, so large amounts stay exact.
      amount_planck: "12345678901234567890",
      edit_count: 0,
      edited_at: null,
      withdrawn_at: null,
      created_at: expect.any(Date),
    })
    expect(await getProposalById(d.id)).toEqual(row)
  })

  it("refuses a reused id, an empty title or a negative amount", async () => {
    const d = draftFixture()
    await insertProposalDraft(d)
    await expect(insertProposalDraft(d)).rejects.toMatchObject({ code: "23505" })
    await expect(insertProposalDraft(draftFixture({ title: "" }))).rejects.toMatchObject({
      code: "23514",
    })
    await expect(insertProposalDraft(draftFixture({ amountPlanck: -1n }))).rejects.toMatchObject({
      code: "23514",
    })
  })
})

describe("updateProposalDraft", () => {
  it("re-stages a draft whose sha256 is still the expected one", async () => {
    const { id } = await insertProposalDraft(draftFixture())
    const row = await updateProposalDraft(restage(id))
    expect(row).toMatchObject({
      id,
      title: "Fund the thing, v2",
      json_sha256: SHA_B,
      amount_planck: (10n ** 30n).toString(),
      preimage_len: 42,
      status: "draft",
    })
  })

  it("does nothing when someone changed the draft in the meantime", async () => {
    const { id } = await insertProposalDraft(draftFixture())
    expect(await updateProposalDraft(restage(id))).not.toBeNull()
    // The second writer still expects the first sha256.
    expect(await updateProposalDraft(restage(id, { title: "Stale" }))).toBeNull()
    expect((await getProposalById(id))!.title).toBe("Fund the thing, v2")
  })

  it("does nothing once the proposal left the draft state", async () => {
    for (const leave of [
      (id: string) => attach(id, 7),
      (id: string) => markProposalCancelled(id, null),
      (id: string) => markProposalFailed(id, "dispatch error"),
    ]) {
      const { id } = await insertProposalDraft(draftFixture())
      await leave(id)
      expect(await updateProposalDraft(restage(id))).toBeNull()
      expect((await getProposalById(id))!.json_sha256).toBe(SHA_A)
    }
  })
})

describe("attachReferendumIndex", () => {
  it("puts the proposal on chain and clears a withdrawal flag", async () => {
    const { id } = await insertProposalDraft(draftFixture())
    await setProposalWithdrawn(id, "early", true)
    const row = await attach(id, 12)
    expect(row).toMatchObject({
      status: "on_chain",
      referendum_index: 12,
      tx_hash: "0xtx",
      block_hash: "0xblock",
      withdrawn_at: null,
      withdrawn_reason: null,
    })
    // BIGINT arrives as a string from the Neon driver (pg-types int8), even
    // though ProposalRow types block_number as a number.
    expect(row.block_number).toBe("5000000000")
  })

  it("links one referendum to one proposal per network", async () => {
    const a = await insertProposalDraft(draftFixture())
    const b = await insertProposalDraft(draftFixture())
    const canary = await insertProposalDraft(draftFixture({ network: "canary-relay" }))
    await attach(a.id, 3)
    await expect(attach(b.id, 3)).rejects.toMatchObject({ code: "23505" })
    expect((await getProposalById(b.id))!.status).toBe("draft")
    await expect(attach(canary.id, 3)).resolves.toMatchObject({ referendum_index: 3 })
  })

  it("throws for an unknown proposal", async () => {
    await expect(attach(randomUUID(), 1)).rejects.toThrow(/No proposal/)
  })
})

describe("edits and withdrawal", () => {
  it("updateProposalContent counts edits and leaves the on-chain pin alone", async () => {
    const { id } = await insertProposalDraft(draftFixture({ remarkPayload: "EGOV1:pin" }))
    await attach(id, 1)
    const args = {
      id,
      title: "T2",
      summary: null,
      bodyMarkdown: "B2",
      jsonUrl: "u2",
      jsonSha256: SHA_B,
    }
    await updateProposalContent(args)
    const row = await updateProposalContent({ ...args, title: "T3" })
    expect(row).toMatchObject({
      title: "T3",
      json_sha256: SHA_B,
      edit_count: 2,
      edited_at: expect.any(Date),
      remark_payload: "EGOV1:pin",
      status: "on_chain",
    })
    await expect(updateProposalContent({ ...args, id: randomUUID() })).rejects.toThrow(
      /No proposal/,
    )
  })

  it("setProposalWithdrawn sets and clears the flag without touching the status", async () => {
    const { id } = await insertProposalDraft(draftFixture())
    await attach(id, 1)
    expect(await setProposalWithdrawn(id, "Superseded by #2", true)).toMatchObject({
      status: "on_chain",
      withdrawn_at: expect.any(Date),
      withdrawn_reason: "Superseded by #2",
    })
    expect(await setProposalWithdrawn(id, "ignored", false)).toMatchObject({
      status: "on_chain",
      withdrawn_at: null,
      withdrawn_reason: null,
    })
    await expect(setProposalWithdrawn(id, "x".repeat(281), true)).rejects.toMatchObject({
      code: "23514",
    })
    await expect(setProposalWithdrawn(randomUUID(), null, true)).rejects.toThrow(/No proposal/)
  })
})

describe("cancel, fail and delete", () => {
  it("markProposalCancelled cancels anything not on chain", async () => {
    const draft = await insertProposalDraft(draftFixture())
    expect(await markProposalCancelled(draft.id, null)).toMatchObject({
      status: "cancelled",
      last_error: "Marked outdated by proposer",
    })
    const failed = await insertProposalDraft(draftFixture())
    await markProposalFailed(failed.id, "BadOrigin")
    expect((await getProposalById(failed.id))!).toMatchObject({
      status: "failed",
      last_error: "BadOrigin",
    })
    expect(await markProposalCancelled(failed.id, "Replaced")).toMatchObject({
      status: "cancelled",
      last_error: "Replaced",
    })

    const onChain = await insertProposalDraft(draftFixture())
    await attach(onChain.id, 4)
    expect(await markProposalCancelled(onChain.id, null)).toBeNull()
    expect((await getProposalById(onChain.id))!.status).toBe("on_chain")
    expect(await markProposalCancelled(randomUUID(), null)).toBeNull()
  })

  it("deleteProposalById never deletes an on-chain row", async () => {
    const { id } = await insertProposalDraft(draftFixture())
    await attach(id, 9)
    expect(await deleteProposalById(id)).toBe(false)
    expect(await getProposalById(id)).not.toBeNull()
  })

  it("deleteProposalById deletes drafts, cancelled and failed rows with their files and comments", async () => {
    const author = await upsertUserByAddress(address(2))
    for (const prepare of [
      async () => undefined,
      (id: string) => markProposalCancelled(id, null),
      (id: string) => markProposalFailed(id, "x"),
    ]) {
      const { id } = await insertProposalDraft(draftFixture())
      await prepare(id)
      await insertAttachment({ proposalId: id, ...file(id, "a.png") })
      const c = await createComment({
        proposalId: id,
        parentId: null,
        userId: author.id,
        authorAddress: author.address,
        bodyMarkdown: "hello",
      })
      expect(await deleteProposalById(id)).toBe(true)
      expect(await getProposalById(id)).toBeNull()
      expect(await listAttachments(id)).toEqual([])
      expect(await getCommentById(c.id)).toBeNull()
    }
    expect(await deleteProposalById(randomUUID())).toBe(false)
  })
})

describe("attachments", () => {
  it("insertAttachment and listAttachments, oldest first", async () => {
    const { id } = await insertProposalDraft(draftFixture())
    await insertAttachment({ proposalId: id, ...file(id, "one.png", 2048) })
    await insertAttachment({ proposalId: id, ...file(id, "two.png") })
    const rows = await listAttachments(id)
    expect(rows.map((r) => r.filename)).toEqual(["one.png", "two.png"])
    // BIGINT again: a string at runtime, typed as a number.
    expect(rows[0]!.size_bytes).toBe("2048")
    await expect(
      insertAttachment({ proposalId: id, ...file(id, "big.png", 20 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ code: "23514" })
    await expect(
      insertAttachment({ proposalId: id, ...file(id, "one.png") }),
    ).rejects.toMatchObject({ code: "23505" })
  })

  it("replaceAttachments swaps the whole list, and an empty list clears it", async () => {
    const { id } = await insertProposalDraft(draftFixture())
    await replaceAttachments(id, [file(id, "a.png"), file(id, "b.png")])
    await replaceAttachments(id, [file(id, "b.png"), file(id, "c.png"), file(id, "c.png")])
    expect((await listAttachments(id)).map((r) => r.filename).sort()).toEqual(["b.png", "c.png"])
    await replaceAttachments(id, [])
    expect(await listAttachments(id)).toEqual([])
  })

  it("replaceAttachments never takes over another proposal's file", async () => {
    const mine = await insertProposalDraft(draftFixture())
    const theirs = await insertProposalDraft(draftFixture())
    await replaceAttachments(theirs.id, [file(theirs.id, "t.png")])
    await replaceAttachments(mine.id, [file(theirs.id, "t.png"), file(mine.id, "m.png")])
    expect((await listAttachments(mine.id)).map((r) => r.bucket_key)).toEqual([
      mediaKey(mine.id, "m.png"),
    ])
    expect((await listAttachments(theirs.id)).map((r) => r.bucket_key)).toEqual([
      mediaKey(theirs.id, "t.png"),
    ])
  })
})

describe("lookups", () => {
  it("by proposer: that network and address only, newest first", async () => {
    const me = address(1)
    const first = await insertProposalDraft(draftFixture({ proposerAddress: me }))
    const second = await insertProposalDraft(draftFixture({ proposerAddress: me }))
    await insertProposalDraft(draftFixture({ proposerAddress: address(2) }))
    await insertProposalDraft(draftFixture({ proposerAddress: me, network: "canary-relay" }))
    const rows = await listProposalsByProposer("enjin-relay", me)
    expect(rows.map((r) => r.id)).toEqual([second.id, first.id])
  })

  it("by index: only linked rows of that network", async () => {
    const a = await insertProposalDraft(draftFixture())
    const b = await insertProposalDraft(draftFixture())
    const c = await insertProposalDraft(draftFixture({ network: "canary-relay" }))
    await insertProposalDraft(draftFixture())
    await attach(a.id, 5)
    await attach(b.id, 8)
    await attach(c.id, 5)

    expect((await listProposalsWithIndex("enjin-relay")).map((r) => r.referendum_index)).toEqual([
      8, 5,
    ])
    expect((await getProposalByIndex("enjin-relay", 5))!.id).toBe(a.id)
    expect((await getProposalByIndex("canary-relay", 5))!.id).toBe(c.id)
    expect(await getProposalByIndex("enjin-relay", 6)).toBeNull()

    const many = await getProposalsByIndices("enjin-relay", [5, 6, 8])
    expect(many.map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
    expect(await getProposalsByIndices("canary-relay", [8])).toEqual([])
    expect(await getProposalsByIndices("enjin-relay", [])).toEqual([])
  })

  it("by id: null for an unknown one", async () => {
    expect(await getProposalById(randomUUID())).toBeNull()
  })
})

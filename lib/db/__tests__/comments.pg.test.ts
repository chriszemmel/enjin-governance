import { randomUUID } from "node:crypto"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { address, draftFixture, setupTestDb } from "@/test/pglite"

vi.mock("@/lib/db/client", () => import("@/test/pglite").then((m) => m.dbClientMock))

import { initializeWasm } from "@/lib/chain/ss58"
import {
  createComment,
  editComment,
  findCommentOwnership,
  getCommentById,
  listCommentsForProposal,
  listCommentsForProposalWithAuthors,
  softDeleteComment,
} from "@/lib/db/comments"
import { insertProposalDraft } from "@/lib/db/proposals"
import { updateProfile, upsertUserByAddress, type UserRow } from "@/lib/db/users"

const db = setupTestDb()
beforeAll(() => initializeWasm())

async function setup() {
  const alice = await upsertUserByAddress(address(1))
  const bob = await upsertUserByAddress(address(2))
  const proposal = await insertProposalDraft(draftFixture())
  const post = (
    user: UserRow,
    body: string,
    parentId: string | null = null,
    proposalId = proposal.id,
  ) =>
    createComment({
      proposalId,
      parentId,
      userId: user.id,
      authorAddress: user.address,
      bodyMarkdown: body,
    })
  return { alice, bob, proposal, post }
}

describe("createComment", () => {
  it("stores a comment or a reply and returns the row", async () => {
    const { alice, bob, proposal, post } = await setup()
    const top = await post(alice, "First!")
    const reply = await post(bob, "Welcome", top.id)
    expect(top).toMatchObject({
      proposal_id: proposal.id,
      parent_id: null,
      user_id: alice.id,
      author_address: alice.address,
      body_markdown: "First!",
      is_deleted: false,
      edited_at: null,
      created_at: expect.any(Date),
    })
    expect(reply.parent_id).toBe(top.id)
    expect(await getCommentById(reply.id)).toEqual(reply)
  })

  it("refuses an empty or over-long body, an unknown parent and an unknown proposal", async () => {
    const { alice, post } = await setup()
    await expect(post(alice, "")).rejects.toMatchObject({ code: "23514" })
    await expect(post(alice, "x".repeat(10_001))).rejects.toMatchObject({ code: "23514" })
    await expect(post(alice, "hi", randomUUID())).rejects.toMatchObject({ code: "23503" })
    await expect(post(alice, "hi", null, randomUUID())).rejects.toMatchObject({ code: "23503" })
  })
})

describe("listing", () => {
  it("lists one proposal's comments, oldest first", async () => {
    const { alice, bob, post } = await setup()
    const other = await insertProposalDraft(draftFixture())
    const a = await post(alice, "one")
    const b = await post(bob, "two")
    await post(alice, "elsewhere", null, other.id)
    const c = await post(alice, "three", a.id)
    const rows = await listCommentsForProposal(a.proposal_id)
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id])
  })

  it("joins each comment's author profile", async () => {
    const { alice, bob, post } = await setup()
    await updateProfile(alice.id, { handle: "alice", display_name: "Alice" })
    await db.sql`UPDATE users SET is_verified = TRUE, avatar_url = 'https://a/1.png' WHERE id = ${alice.id}`
    const a = await post(alice, "one")
    await post(bob, "two")
    const rows = await listCommentsForProposalWithAuthors(a.proposal_id)
    expect(
      rows.map((r) => [
        r.body_markdown,
        r.author_handle,
        r.author_display_name,
        r.author_avatar_url,
        r.author_is_verified,
      ]),
    ).toEqual([
      ["one", "alice", "Alice", "https://a/1.png", true],
      ["two", null, null, null, false],
    ])
  })
})

describe("ownership, edits and deletes", () => {
  it("findCommentOwnership names the author, or null", async () => {
    const { alice, post } = await setup()
    const c = await post(alice, "mine")
    expect(await findCommentOwnership(c.id)).toEqual({ userId: alice.id })
    expect(await findCommentOwnership(randomUUID())).toBeNull()
  })

  it("editComment changes only the author's own, live, recent comment", async () => {
    const { alice, bob, post } = await setup()
    const c = await post(alice, "typo")
    expect(await editComment(c.id, bob.id, "hijack")).toBeNull()
    expect(await editComment(c.id, alice.id, "fixed")).toMatchObject({
      body_markdown: "fixed",
      edited_at: expect.any(Date),
    })

    const old = await post(alice, "long ago")
    await db.sql`UPDATE comments SET created_at = NOW() - INTERVAL '1 day' WHERE id = ${old.id}`
    expect(await editComment(old.id, alice.id, "rewrite history")).toBeNull()

    await softDeleteComment(c.id, alice.id)
    expect(await editComment(c.id, alice.id, "back")).toBeNull()
    expect((await getCommentById(c.id))!.body_markdown).toBe("[deleted]")
  })

  it("softDeleteComment works only for the author and keeps the slot and its replies", async () => {
    const { alice, bob, post } = await setup()
    const parent = await post(alice, "secret phone number")
    const reply = await post(bob, "you posted your number", parent.id)

    expect(await softDeleteComment(parent.id, bob.id)).toBe(false)
    expect((await getCommentById(parent.id))!.is_deleted).toBe(false)

    expect(await softDeleteComment(parent.id, alice.id)).toBe(true)
    const rows = await listCommentsForProposalWithAuthors(parent.proposal_id)
    expect(rows.map((r) => [r.id, r.is_deleted, r.body_markdown])).toEqual([
      // The original text is gone from the database, not just hidden.
      [parent.id, true, "[deleted]"],
      [reply.id, false, "you posted your number"],
    ])
    expect(await softDeleteComment(randomUUID(), alice.id)).toBe(false)
  })
})

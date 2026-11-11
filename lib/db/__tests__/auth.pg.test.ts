import { beforeAll, describe, expect, it, vi } from "vitest"
import { address, setupTestDb } from "@/test/pglite"

vi.mock("@/lib/db/client", () => import("@/test/pglite").then((m) => m.dbClientMock))

import { initializeWasm } from "@/lib/chain/ss58"
import { consumeNonceRow, gcExpiredNonces, insertNonce } from "@/lib/db/auth-nonces"
import { deleteSession, getActiveSession, insertSession } from "@/lib/db/sessions"
import {
  getUserByAddress,
  getUsersByAddresses,
  setAvatar,
  updateProfile,
  upsertUserByAddress,
} from "@/lib/db/users"

const db = setupTestDb()
beforeAll(() => initializeWasm())

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000)

describe("users", () => {
  it("creates a user once per address, with the network its format names", async () => {
    const first = await upsertUserByAddress(address(1))
    const again = await upsertUserByAddress(address(1))
    expect(again.id).toBe(first.id)
    expect(first).toMatchObject({ address: address(1), network: "enjin-relay", handle: null })
    // The same key on Canary is another user.
    const canary = await upsertUserByAddress(address(1, "canary-relay"))
    expect(canary).toMatchObject({ network: "canary-relay" })
    expect(canary.id).not.toBe(first.id)
    expect(await db.sql`SELECT COUNT(*)::int AS n FROM users`).toEqual([{ n: 2 }])
  })

  it("looks users up by one or many addresses", async () => {
    const a = await upsertUserByAddress(address(1))
    const b = await upsertUserByAddress(address(2))
    expect(await getUserByAddress(address(1))).toEqual(a)
    expect(await getUserByAddress(address(3))).toBeNull()
    const many = await getUsersByAddresses([address(2), address(3), address(1)])
    expect(many.map((u) => u.id).sort()).toEqual([a.id, b.id].sort())
    expect(await getUsersByAddresses([])).toEqual([])
  })

  it("updates the profile fields it's given and bumps updated_at", async () => {
    const u = await upsertUserByAddress(address(1))
    const row = await updateProfile(u.id, { display_name: "Chris", bio: "Hi" })
    expect(row).toMatchObject({ display_name: "Chris", bio: "Hi", handle: null })
    expect(row.updated_at.getTime()).toBeGreaterThan(u.updated_at.getTime())
    // Fields left out keep their value.
    expect(await updateProfile(u.id, { handle: "chris" })).toMatchObject({
      display_name: "Chris",
      bio: "Hi",
      handle: "chris",
    })
    await expect(
      updateProfile("00000000-0000-4000-8000-000000000000", { bio: "x" }),
    ).rejects.toThrow(/No user/)
  })

  // The account page sends null for a field the user emptied.
  it("clears a field given null and keeps the ones left out", async () => {
    const u = await upsertUserByAddress(address(1))
    await updateProfile(u.id, { display_name: "Chris", bio: "Old bio", handle: "chris" })
    expect(await updateProfile(u.id, { bio: null })).toMatchObject({
      display_name: "Chris",
      bio: null,
      handle: "chris",
    })
    expect(await updateProfile(u.id, { display_name: null, handle: null })).toMatchObject({
      display_name: null,
      bio: null,
      handle: null,
    })
  })

  it("keeps handles unique per network, ignoring case, with the error users/me turns into a 409", async () => {
    const a = await upsertUserByAddress(address(1))
    const b = await upsertUserByAddress(address(2))
    const onCanary = await upsertUserByAddress(address(2, "canary-relay"))
    await updateProfile(a.id, { handle: "chris" })

    const taken = updateProfile(b.id, { handle: "chris" })
    await expect(taken).rejects.toMatchObject({ code: "23505" })
    // app/api/users/me maps the unique violation to 409 by its message.
    await expect(taken).rejects.toThrow(/unique|duplicate/i)
    await expect(updateProfile(b.id, { handle: "CHRIS" })).rejects.toMatchObject({ code: "23505" })

    await expect(updateProfile(onCanary.id, { handle: "chris" })).resolves.toMatchObject({
      handle: "chris",
    })
    await expect(updateProfile(b.id, { handle: "no spaces" })).rejects.toMatchObject({
      code: "23514",
    })
  })

  it("doesn't cover rows without a network (why users/me refuses them a handle)", async () => {
    await db.sql`INSERT INTO users (address) VALUES ('legacy-1'), ('legacy-2')`
    const [one, two] = await db.sql`SELECT id FROM users ORDER BY address`
    await updateProfile(one!.id as string, { handle: "twin" })
    await expect(updateProfile(two!.id as string, { handle: "twin" })).resolves.toMatchObject({
      handle: "twin",
    })
  })

  it("sets the avatar", async () => {
    const u = await upsertUserByAddress(address(1))
    await setAvatar(u.id, "https://cdn.example/a.webp", "user-avatars/a.webp")
    expect(await getUserByAddress(u.address)).toMatchObject({
      avatar_url: "https://cdn.example/a.webp",
      avatar_key: "user-avatars/a.webp",
      avatar_updated_at: expect.any(Date),
    })
  })
})

describe("wallet sessions", () => {
  const session = (userId: string, over: Partial<Parameters<typeof insertSession>[0]> = {}) =>
    insertSession({
      tokenHash: "h".repeat(64),
      userId,
      address: address(1),
      expiresAt: inMinutes(60),
      userAgent: "vitest",
      ipAddress: "203.0.113.7",
      ...over,
    })

  it("finds a live session by token hash and forgets it on delete", async () => {
    const u = await upsertUserByAddress(address(1))
    await session(u.id)
    expect(await getActiveSession("h".repeat(64))).toMatchObject({
      user_id: u.id,
      address: address(1),
      user_agent: "vitest",
      ip_address: "203.0.113.7",
      expires_at: expect.any(Date),
    })
    expect(await getActiveSession("x".repeat(64))).toBeNull()
    await deleteSession("h".repeat(64))
    expect(await getActiveSession("h".repeat(64))).toBeNull()
  })

  it("doesn't honour an expired session", async () => {
    const u = await upsertUserByAddress(address(1))
    await session(u.id, { expiresAt: inMinutes(-1) })
    expect(await getActiveSession("h".repeat(64))).toBeNull()
  })

  it("touches last_seen_at on use", async () => {
    const u = await upsertUserByAddress(address(1))
    await session(u.id)
    await db.sql`UPDATE wallet_sessions SET last_seen_at = NOW() - INTERVAL '1 day'`
    await getActiveSession("h".repeat(64))
    // The touch is fire-and-forget; this query runs after it.
    const [row] =
      await db.sql`SELECT last_seen_at > NOW() - INTERVAL '1 minute' AS fresh FROM wallet_sessions`
    expect(row).toEqual({ fresh: true })
  })

  it("takes a null IP but refuses text that isn't one", async () => {
    const u = await upsertUserByAddress(address(1))
    await expect(session(u.id, { ipAddress: null })).resolves.toBeUndefined()
    await expect(
      session(u.id, { tokenHash: "i".repeat(64), ipAddress: "unknown" }),
    ).rejects.toMatchObject({ code: "22P02" })
  })

  it("goes with its user", async () => {
    const u = await upsertUserByAddress(address(1))
    await session(u.id)
    await db.sql`DELETE FROM users WHERE id = ${u.id}`
    expect(await getActiveSession("h".repeat(64))).toBeNull()
  })
})

describe("sign-in nonces", () => {
  const nonce = "0123456789abcdef0123456789abcdef"
  const issue = (over: Partial<Parameters<typeof insertNonce>[0]> = {}) =>
    insertNonce({
      nonce,
      address: address(1),
      message: "Sign in\nNonce: n",
      expiresAt: inMinutes(5),
      ...over,
    })

  it("is consumed exactly once and hands back the stored message", async () => {
    await issue()
    expect(await consumeNonceRow({ nonce, address: address(1) })).toEqual({
      message: "Sign in\nNonce: n",
    })
    expect(await consumeNonceRow({ nonce, address: address(1) })).toBeNull()
  })

  it("can't be used by another address, and stays usable by its own", async () => {
    await issue()
    expect(await consumeNonceRow({ nonce, address: address(2) })).toBeNull()
    expect(await consumeNonceRow({ nonce, address: address(1) })).not.toBeNull()
  })

  it("doesn't work once expired", async () => {
    await issue({ expiresAt: inMinutes(-1) })
    expect(await consumeNonceRow({ nonce, address: address(1) })).toBeNull()
  })

  it("lets only one of several concurrent verifies through", async () => {
    await issue()
    db.jitterMs = 3
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeNonceRow({ nonce, address: address(1) })),
    )
    expect(results.filter((r) => r !== null)).toHaveLength(1)
  })

  it("can't be issued twice", async () => {
    await issue()
    await expect(issue()).rejects.toMatchObject({ code: "23505" })
  })

  it("gcExpiredNonces sweeps only expired rows", async () => {
    await issue({ nonce: "a".repeat(32), expiresAt: inMinutes(-10) })
    await issue({ nonce: "b".repeat(32), expiresAt: inMinutes(10) })
    await gcExpiredNonces()
    expect(await db.sql`SELECT nonce FROM auth_nonces`).toEqual([{ nonce: "b".repeat(32) }])
  })
})

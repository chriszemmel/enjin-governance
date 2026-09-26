import { beforeAll, describe, expect, it, vi } from "vitest"
import { address, draftFixture, mediaKey, publicKey, setupTestDb } from "@/test/pglite"

vi.mock("@/lib/db/client", () => import("@/test/pglite").then((m) => m.dbClientMock))

import { initializeWasm } from "@/lib/chain/ss58"
import { createComment } from "@/lib/db/comments"
import {
  addScanTokens,
  claimSettingSlot,
  closeReports,
  getGrantedRole,
  getSetting,
  getState,
  getSuspension,
  grantRole,
  insertAction,
  insertReport,
  listActions,
  listQueue,
  listRoles,
  listStatesForProposal,
  openReportCount,
  queueStats,
  reserveScanCheck,
  revokeRole,
  saveSetting,
  scanChecksToday,
  scanUsageThisMonth,
  setState,
  setSuspension,
} from "@/lib/db/moderation"
import { deleteProposalById, insertAttachment, insertProposalDraft } from "@/lib/db/proposals"
import { upsertUserByAddress } from "@/lib/db/users"

const db = setupTestDb()
beforeAll(() => initializeWasm())

const MODEL = "claude-haiku-4-5"

/** Checks counted per kind today, straight from the table. */
async function checksByKind(): Promise<Record<string, number>> {
  const rows = await db.sql`
    SELECT kind, SUM(checks)::int AS n FROM moderation_scan_usage
     WHERE day = (NOW() AT TIME ZONE 'UTC')::date GROUP BY kind
  `
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]))
}

async function reserveMany(n: number, kind: Parameters<typeof reserveScanCheck>[1], limit: number) {
  const out: boolean[] = []
  for (let i = 0; i < n; i++) out.push(await reserveScanCheck(MODEL, kind, limit))
  return out
}

describe("reserveScanCheck", () => {
  it("allows checks up to the daily limit, then refuses and takes the refused one back", async () => {
    expect(await reserveMany(4, "images", 3)).toEqual([true, true, true, false])
    expect(await scanChecksToday()).toBe(3)
    expect(await reserveScanCheck(MODEL, "pdfs", 3)).toBe(false)
    expect(await checksByKind()).toEqual({ images: 3, pdfs: 0 })
  })

  it("lets proposal text and comments use at most half the limit, leaving the rest to uploads", async () => {
    expect(await reserveMany(3, "comments", 10)).toEqual([true, true, true])
    expect(await reserveMany(3, "proposals", 10)).toEqual([true, true, false])
    expect(await reserveMany(6, "images", 10)).toEqual([true, true, true, true, true, false])
    expect(await checksByKind()).toEqual({ comments: 3, proposals: 2, images: 5 })
    // An odd limit rounds the text half down.
    await db.reset()
    expect(await reserveMany(3, "comments", 5)).toEqual([true, true, false])
  })

  it("never counts below zero, however often it refuses", async () => {
    expect(await reserveMany(5, "images", 0)).toEqual([false, false, false, false, false])
    const rows = await db.sql`SELECT checks FROM moderation_scan_usage`
    expect(rows).toEqual([{ checks: 0 }])
  })

  it("shares today's limit across models and ignores other days", async () => {
    await db.sql`
      INSERT INTO moderation_scan_usage (day, model, kind, checks)
      VALUES ((NOW() AT TIME ZONE 'UTC')::date - 1, ${MODEL}, 'images', 100)
    `
    expect(await reserveScanCheck("model-a", "images", 2)).toBe(true)
    expect(await reserveScanCheck("model-b", "images", 2)).toBe(true)
    expect(await reserveScanCheck("model-a", "images", 2)).toBe(false)
    expect(await scanChecksToday()).toBe(2)
  })

  it("can't be pushed past the limit by concurrent checks", async () => {
    db.jitterMs = 4
    const limit = 10
    const kinds = ["images", "comments", "pdfs", "proposals"] as const
    let allowed = 0
    let allowedText = 0
    for (let wave = 0; wave < 4; wave++) {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => {
          const kind = kinds[i % kinds.length]!
          return reserveScanCheck(MODEL, kind, limit).then((ok) => ({ ok, kind }))
        }),
      )
      for (const r of results.filter((r) => r.ok)) {
        allowed++
        if (r.kind === "comments" || r.kind === "proposals") allowedText++
      }
    }
    expect(allowed).toBeLessThanOrEqual(limit)
    expect(allowedText).toBeLessThanOrEqual(limit / 2)
    // Every refusal took its count back: what's counted is exactly what ran.
    expect(await scanChecksToday()).toBe(allowed)
    const byKind = await checksByKind()
    expect((byKind.comments ?? 0) + (byKind.proposals ?? 0)).toBe(allowedText)
    expect(Math.min(...Object.values(byKind))).toBeGreaterThanOrEqual(0)
  })
})

describe("scan usage", () => {
  it("adds tokens to today's row without counting another check", async () => {
    expect(await reserveScanCheck(MODEL, "images", 10)).toBe(true)
    await addScanTokens({ model: MODEL, kind: "images", inputTokens: 1200, outputTokens: 30 })
    await addScanTokens({ model: MODEL, kind: "images", inputTokens: 800, outputTokens: 20 })
    // Tokens for a check counted under another row (e.g. before midnight) start a row at 0 checks.
    await addScanTokens({ model: MODEL, kind: "pdfs", inputTokens: 5, outputTokens: 1 })
    expect(await scanChecksToday()).toBe(1)
    expect(await scanUsageThisMonth()).toEqual([
      { model: MODEL, kind: "images", checks: 1, input_tokens: 2000, output_tokens: 50 },
      { model: MODEL, kind: "pdfs", checks: 0, input_tokens: 5, output_tokens: 1 },
    ])
  })

  it("sums this month per model and kind, leaving out last month", async () => {
    await db.sql`
      INSERT INTO moderation_scan_usage (day, model, kind, checks, input_tokens, output_tokens)
      VALUES
        ((NOW() AT TIME ZONE 'UTC')::date, 'b-model', 'comments', 2, 10, 1),
        ((NOW() AT TIME ZONE 'UTC')::date, 'a-model', 'images', 1, 3000000000, 7),
        (date_trunc('month', NOW() AT TIME ZONE 'UTC')::date, 'a-model', 'pdfs', 4, 1, 1),
        (date_trunc('month', NOW() AT TIME ZONE 'UTC')::date - 1, 'a-model', 'images', 50, 99, 99)
    `
    expect(await scanUsageThisMonth()).toEqual([
      { model: "a-model", kind: "images", checks: 1, input_tokens: 3000000000, output_tokens: 7 },
      { model: "a-model", kind: "pdfs", checks: 4, input_tokens: 1, output_tokens: 1 },
      { model: "b-model", kind: "comments", checks: 2, input_tokens: 10, output_tokens: 1 },
    ])
    const firstOfMonthIsToday = new Date().getUTCDate() === 1
    expect(await scanChecksToday()).toBe(firstOfMonthIsToday ? 7 : 3)
  })
})

describe("settings", () => {
  it("returns null for a missing key and round-trips JSON values", async () => {
    expect(await getSetting("scan")).toBeNull()
    await saveSetting("scan", { enabled: true, dailyLimit: 200, kinds: ["images"] }, "0xadmin")
    expect(await getSetting("scan")).toEqual({ enabled: true, dailyLimit: 200, kinds: ["images"] })
    await saveSetting("flag", false, "0xadmin")
    expect(await getSetting("flag")).toBe(false)
  })

  it("claimSettingSlot hands out one claim per window", async () => {
    expect(await claimSettingSlot("slot:digest", 3600, "server-a")).toBe(true)
    expect(await claimSettingSlot("slot:digest", 3600, "server-b")).toBe(false)
    expect(await claimSettingSlot("slot:other", 3600, "server-b")).toBe(true)
    await db.sql`
      UPDATE moderation_settings SET updated_at = NOW() - INTERVAL '61 minutes'
       WHERE key = 'slot:digest'
    `
    expect(await claimSettingSlot("slot:digest", 3600, "server-b")).toBe(true)
    const rows = await db.sql`SELECT updated_by FROM moderation_settings WHERE key = 'slot:digest'`
    expect(rows).toEqual([{ updated_by: "server-b" }])
  })

  it("claimSettingSlot lets only one of several concurrent claims win", async () => {
    db.jitterMs = 3
    const wins = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claimSettingSlot("slot:race", 60, `server-${i}`)),
    )
    expect(wins.filter(Boolean)).toHaveLength(1)
  })

  it("overwrites a saved value and records who saved it", async () => {
    await saveSetting("scan", { enabled: true }, "0xfirst")
    await saveSetting("scan", { enabled: false }, "0xsecond")
    expect(await getSetting("scan")).toEqual({ enabled: false })
    const rows = await db.sql`SELECT key, updated_by FROM moderation_settings`
    expect(rows).toEqual([{ key: "scan", updated_by: "0xsecond" }])
  })
})

describe("roles", () => {
  it("grants, changes and revokes a role", async () => {
    const key = publicKey(1)
    expect(await getGrantedRole(key)).toBeNull()
    await grantRole(key, "moderator", "0xadmin")
    expect(await getGrantedRole(key)).toBe("moderator")
    await grantRole(key, "admin", "0xother")
    expect(await getGrantedRole(key)).toBe("admin")
    await grantRole(publicKey(2), "moderator", "0xadmin")
    expect((await listRoles()).map((r) => [r.public_key, r.role, r.granted_by])).toEqual([
      [key, "admin", "0xother"],
      [publicKey(2), "moderator", "0xadmin"],
    ])
    expect(await revokeRole(key)).toBe(true)
    expect(await revokeRole(key)).toBe(false)
    expect(await getGrantedRole(key)).toBeNull()
  })

  it("only stores lower-case 32-byte keys and known roles", async () => {
    await expect(grantRole(publicKey(1).toUpperCase(), "moderator", "x")).rejects.toMatchObject({
      code: "23514",
    })
    await expect(grantRole("0x1234", "moderator", "x")).rejects.toMatchObject({ code: "23514" })
    await expect(grantRole(publicKey(1), "owner" as unknown as "admin", "x")).rejects.toMatchObject(
      { code: "23514" },
    )
  })
})

describe("suspensions", () => {
  it("pauses until a time, lifts itself after it, and can be lifted early", async () => {
    const key = publicKey(7)
    expect(await getSuspension(key)).toBeNull()
    const until = new Date(Date.now() + 7 * 24 * 3600_000)
    await setSuspension(key, until, "0xadmin")
    expect(await getSuspension(key)).toEqual(until)
    const sooner = new Date(Date.now() + 3600_000)
    await setSuspension(key, sooner, "0xadmin")
    expect(await getSuspension(key)).toEqual(sooner)
    await setSuspension(key, new Date(Date.now() - 1000), "0xadmin")
    expect(await getSuspension(key)).toBeNull()
    await setSuspension(key, until, "0xadmin")
    await setSuspension(key, null, "0xadmin")
    expect(await getSuspension(key)).toBeNull()
    expect(await db.sql`SELECT * FROM moderation_suspensions`).toEqual([])
  })
})

describe("moderation state", () => {
  it("sets and updates one item's state", async () => {
    const p = await insertProposalDraft(draftFixture())
    expect(await getState("proposal", p.id)).toBeNull()
    await setState({
      targetType: "proposal",
      targetId: p.id,
      proposalId: p.id,
      state: "blurred",
      reason: "automatic check",
      source: "automatic",
    })
    await setState({
      targetType: "proposal",
      targetId: p.id,
      proposalId: null,
      state: "hidden",
      reason: "scam",
      source: "moderator",
    })
    expect(await getState("proposal", p.id)).toMatchObject({
      target_type: "proposal",
      target_id: p.id,
      // A later decision without a proposal keeps the one already known.
      proposal_id: p.id,
      state: "hidden",
      reason: "scam",
      source: "moderator",
      updated_at: expect.any(Date),
    })
  })

  it("lists a proposal's non-visible items, including uploads saved before the draft", async () => {
    const p = await insertProposalDraft(draftFixture())
    const other = await insertProposalDraft(draftFixture())
    const set = (
      targetType: "proposal" | "attachment" | "comment",
      targetId: string,
      proposalId: string | null,
      state: "visible" | "blurred" | "hidden" | "removed",
    ) => setState({ targetType, targetId, proposalId, state, reason: "r", source: "moderator" })
    await set("proposal", p.id, p.id, "blurred")
    await set("attachment", mediaKey(p.id, "a.png"), p.id, "hidden")
    await set("attachment", mediaKey(p.id, "early.png"), null, "removed")
    await set("attachment", mediaKey(p.id, "fine.png"), null, "visible")
    await set("comment", "00000000-0000-4000-8000-000000000001", p.id, "hidden")
    await set("attachment", mediaKey(other.id, "b.png"), null, "hidden")
    await set("proposal", other.id, other.id, "hidden")

    const rows = await listStatesForProposal(p.id)
    expect(rows.map((r) => [r.target_type, r.target_id, r.state]).sort()).toEqual(
      [
        ["attachment", mediaKey(p.id, "a.png"), "hidden"],
        ["attachment", mediaKey(p.id, "early.png"), "removed"],
        ["comment", "00000000-0000-4000-8000-000000000001", "hidden"],
        ["proposal", p.id, "blurred"],
      ].sort(),
    )
  })

  it("outlives a deleted draft: state, reports and the log keep their rows (ON DELETE SET NULL)", async () => {
    const p = await insertProposalDraft(draftFixture())
    const key = mediaKey(p.id)
    await setState({
      targetType: "attachment",
      targetId: key,
      proposalId: p.id,
      state: "hidden",
      reason: "personal data",
      source: "moderator",
    })
    await insertReport({
      targetType: "attachment",
      targetId: key,
      proposalId: p.id,
      source: "automatic",
      reporterUserId: null,
      category: "personal_data",
      severity: "high",
      note: null,
      details: null,
    })
    await insertAction({
      targetType: "attachment",
      targetId: key,
      proposalId: p.id,
      network: "enjin-relay",
      referendumIndex: null,
      action: "hide",
      reason: "personal data",
      source: "moderator",
      actorPublicKey: publicKey(1),
      actorLabel: "Mod",
    })

    expect(await deleteProposalById(p.id)).toBe(true)

    expect(await getState("attachment", key)).toMatchObject({ state: "hidden", proposal_id: null })
    expect(await openReportCount("attachment", key)).toBe(1)
    expect(await listActions(10)).toMatchObject([
      { target_id: key, proposal_id: null, action: "hide" },
    ])
    // Found by its folder, so /r keeps refusing the file.
    expect((await listStatesForProposal(p.id)).map((r) => r.target_id)).toEqual([key])
  })
})

describe("public log", () => {
  const action = (n: number, over: Partial<Parameters<typeof insertAction>[0]> = {}) =>
    insertAction({
      targetType: "proposal",
      targetId: `target-${n}`,
      proposalId: null,
      network: "enjin-relay",
      referendumIndex: n,
      action: "blur",
      reason: `reason ${n}`,
      source: "moderator",
      actorPublicKey: publicKey(1),
      actorLabel: "Mod",
      ...over,
    })

  it("lists newest first, pages with `before`, and holds only log fields", async () => {
    for (let n = 1; n <= 4; n++) await action(n)
    const page1 = await listActions(2)
    expect(page1.map((r) => r.target_id)).toEqual(["target-4", "target-3"])
    const page2 = await listActions(2, page1[1]!.created_at)
    expect(page2.map((r) => r.target_id)).toEqual(["target-2", "target-1"])
    expect(await listActions(2, page2[1]!.created_at)).toEqual([])
    // Nothing about who reported anything, or a report's notes, reaches the log.
    expect(Object.keys(page1[0]!).sort()).toEqual([
      "action",
      "actor_label",
      "actor_public_key",
      "created_at",
      "id",
      "network",
      "proposal_id",
      "reason",
      "referendum_index",
      "source",
      "target_id",
      "target_type",
    ])
  })

  it("refuses an action without a reason or outside the known set", async () => {
    await expect(action(1, { reason: "" })).rejects.toMatchObject({ code: "23514" })
    await expect(action(1, { action: "purge" })).rejects.toMatchObject({ code: "23514" })
    expect(await listActions(10)).toEqual([])
  })
})

describe("reports", () => {
  const report = (over: Partial<Parameters<typeof insertReport>[0]> = {}) =>
    insertReport({
      targetType: "proposal",
      targetId: "p-1",
      proposalId: null,
      source: "user",
      reporterUserId: null,
      category: "spam",
      severity: "medium",
      note: null,
      details: null,
      ...over,
    })

  it("keeps one open report per person per item and one open automatic flag", async () => {
    const u1 = await upsertUserByAddress(address(1))
    const u2 = await upsertUserByAddress(address(2))
    expect(await report({ reporterUserId: u1.id })).toBe(true)
    expect(await report({ reporterUserId: u1.id, category: "scam" })).toBe(false)
    expect(await report({ reporterUserId: u2.id })).toBe(true)
    expect(await report({ source: "automatic", category: "scam" })).toBe(true)
    expect(await report({ source: "automatic", category: "illegal" })).toBe(false)
    expect(await report({ targetId: "p-2", reporterUserId: u1.id })).toBe(true)
    expect(await openReportCount("proposal", "p-1")).toBe(3)
    expect(await openReportCount("comment", "p-1")).toBe(0)
  })

  it("closes only the item's open reports, after which it can be reported again", async () => {
    const u1 = await upsertUserByAddress(address(1))
    await report({ reporterUserId: u1.id })
    await report({ targetId: "p-2", reporterUserId: u1.id })
    await closeReports("proposal", "p-1", "dismissed")
    expect(await openReportCount("proposal", "p-1")).toBe(0)
    expect(await openReportCount("proposal", "p-2")).toBe(1)
    const closed =
      await db.sql`SELECT status, resolved_at FROM moderation_reports WHERE target_id = 'p-1'`
    expect(closed).toEqual([{ status: "dismissed", resolved_at: expect.any(Date) }])

    expect(await report({ reporterUserId: u1.id })).toBe(true)
    await closeReports("proposal", "p-1", "resolved")
    const all = await db.sql`
      SELECT status FROM moderation_reports WHERE target_id = 'p-1' ORDER BY created_at
    `
    // An earlier decision isn't rewritten by a later one.
    expect(all.map((r) => r.status)).toEqual(["dismissed", "resolved"])
  })

  it("groups the open queue per item, most severe and oldest first", async () => {
    const author = await upsertUserByAddress(address(3))
    const u1 = await upsertUserByAddress(address(1))
    const u2 = await upsertUserByAddress(address(2))
    const p = await insertProposalDraft(draftFixture({ title: "Grant for tooling" }))
    const key = mediaKey(p.id, "scan.png")
    await insertAttachment({
      proposalId: p.id,
      bucketKey: key,
      url: `https://cdn.example/${key}`,
      filename: "scan.png",
      contentType: "image/png",
      sizeBytes: 1234,
      sha256: "b".repeat(64),
      uploadedBy: null,
    })
    const c = await createComment({
      proposalId: p.id,
      parentId: null,
      userId: author.id,
      authorAddress: author.address,
      bodyMarkdown: "buy my coin",
    })

    await report({
      targetType: "proposal",
      targetId: p.id,
      proposalId: p.id,
      reporterUserId: u1.id,
      severity: "low",
    })
    await report({
      targetType: "comment",
      targetId: c.id,
      proposalId: p.id,
      reporterUserId: u1.id,
      category: "spam",
      note: "first",
    })
    await report({
      targetType: "comment",
      targetId: c.id,
      proposalId: p.id,
      reporterUserId: u2.id,
      category: "harassment",
      note: "second",
    })
    // Checked before the draft was saved: no proposal id, only the key's folder.
    await report({
      targetType: "attachment",
      targetId: key,
      source: "automatic",
      category: "personal_data",
      severity: "high",
      details: { finding: "passport", confidence: 0.9 },
    })
    await setState({
      targetType: "attachment",
      targetId: key,
      proposalId: null,
      state: "blurred",
      reason: "automatic check",
      source: "automatic",
    })
    // Closed reports stay out of the queue.
    await report({ targetType: "proposal", targetId: "gone", reporterUserId: u1.id })
    await closeReports("proposal", "gone", "resolved")

    const queue = await listQueue()
    expect(queue.map((q) => [q.target_type, q.severity])).toEqual([
      ["attachment", "high"],
      ["comment", "medium"],
      ["proposal", "low"],
    ])
    expect(queue[0]).toMatchObject({
      target_id: key,
      proposal_id: p.id,
      reports: 1,
      user_reports: 0,
      automatic: true,
      categories: ["personal_data"],
      notes: [],
      details: [{ finding: "passport", confidence: 0.9 }],
      state: "blurred",
      state_reason: "automatic check",
      proposal_title: "Grant for tooling",
      network: "enjin-relay",
      attachment_name: "scan.png",
      attachment_type: "image/png",
      comment_body: null,
    })
    expect(queue[1]).toMatchObject({
      target_id: c.id,
      proposal_id: p.id,
      reports: 2,
      user_reports: 2,
      automatic: false,
      categories: ["harassment", "spam"],
      notes: ["first", "second"],
      details: [],
      state: null,
      comment_body: "buy my coin",
      comment_author: author.address,
      first_at: expect.any(Date),
    })
    expect(queue[1]!.first_at.getTime()).toBeLessThanOrEqual(queue[1]!.last_at.getTime())

    expect(await queueStats()).toEqual({ open: 4, auto_blurred_today: 1 })
  })
})

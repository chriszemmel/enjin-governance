/**
 * A backup restores exactly. A migrated database gets rows in every table,
 * edge values included (a 30-digit NUMERIC, BIGINTs past 2^53, microsecond
 * timestamps, JSONB null, strings and big numbers, text that holds the
 * dollar-quote tag, quotes, backslashes and emoji, a comment thread, more
 * rows than one page). A backup is made through the real code, only R2
 * faked; its db/restore.sql then runs against a second freshly migrated
 * database, and every table must match row for row.
 */
import { randomUUID } from "node:crypto"
import { PGlite } from "@electric-sql/pglite"
import { strFromU8, unzipSync } from "fflate"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { address, mediaKey, publicKey, setupTestDb } from "@/test/pglite"

vi.mock("@/lib/db/client", () => import("@/test/pglite").then((m) => m.dbClientMock))
vi.mock("@/lib/r2/client", async () => {
  const r2 = await import("@/lib/__sec__/fake-r2")
  return { getR2Client: () => r2.client, r2Bucket: () => "enjin-governance" }
})

import * as r2 from "@/lib/__sec__/fake-r2"
import { createBackup } from "@/lib/backup/create"
import { getSql } from "@/lib/db/client"

// The source is set up last, so it is the database getSql() serves.
const target = setupTestDb()
const source = setupTestDb()

const TRICKY =
  "Quotes ' \" and \\ backslashes \\n, the tags $json$ and $json1$, a $$ pair, tab\there, new\nline, emoji 🦄, Ümlaut."
const BIG_BLOCK = "9007199254740993" // 2^53 + 1: not a safe JavaScript number
const AMOUNT = "123456789012345678901234567890"
const REPORT_DETAILS = '{"big": 12345678901234567890123, "tag": "$json$", "list": [1, 2.5, null]}'

type Sql = typeof source.sql

async function seed(sql: Sql) {
  const [alice] = await sql`
    INSERT INTO users (address, handle, display_name, bio, avatar_url, avatar_key,
                       avatar_updated_at, network, is_verified, verified_at, created_at)
    VALUES (${address(1)}, 'alice', 'Alice 🦄', ${TRICKY}, 'https://gov.test/r/user-avatars/a.png',
            'user-avatars/a.png', '2026-03-04 05:06:07.891234+00', 'enjin-relay', TRUE,
            '2026-03-05 00:00:00.000001+00', '2026-01-01 00:00:00.5+00')
    RETURNING id`
  const [bob] =
    await sql`INSERT INTO users (address) VALUES (${address(2, "canary-relay")}) RETURNING id`

  // Short-lived secrets: never in a backup.
  await sql`
    INSERT INTO wallet_sessions (token_hash, user_id, address, expires_at, user_agent, ip_address)
    VALUES (${"f".repeat(64)}, ${alice!.id}, ${address(1)}, NOW() + INTERVAL '30 days',
            'Mozilla/5.0 (secret agent)', '203.0.113.7')`
  await sql`
    INSERT INTO auth_nonces (nonce, address, message, expires_at)
    VALUES ('nonce-secret', ${address(1)}, 'Sign in to Enjin Governance', NOW() + INTERVAL '5 minutes')`

  const p1 = randomUUID()
  const p1Key = `proposals/enjin-relay/${p1}/proposal-aaaaaaaaaaaaaaaa.json`
  await sql`
    INSERT INTO proposals (id, network, referendum_index, proposer_user_id, proposer_address, title,
                           summary, body_markdown, track, beneficiary, amount_planck, json_url, json_key,
                           json_sha256, preimage_hash, preimage_len, remark_payload,
                           tx_hash, block_hash, block_number, status, created_at, edited_at, edit_count,
                           withdrawn_at, withdrawn_reason)
    VALUES (${p1}, 'enjin-relay', 42, ${alice!.id}, ${address(1)}, 'Fund the thing', 'Short.', ${TRICKY},
            'treasurer', ${address(3)}, ${AMOUNT}, ${`https://gov.test/r/${p1Key}`}, ${p1Key},
            ${"a".repeat(64)}, '0xpre', 1234, 'EGOV1:{}', '0xtx', '0xblock', ${BIG_BLOCK},
            'on_chain', '2026-01-02 03:04:05.123456+00', '2026-01-03 00:00:00+00', 2,
            '2026-02-01 00:00:00.000001+00', 'Changed my mind')`
  const p2 = randomUUID()
  const p2Key = `proposals/canary-relay/${p2}/proposal.json`
  await sql`
    INSERT INTO proposals (id, network, proposer_address, title, json_url, json_key, json_sha256)
    VALUES (${p2}, 'canary-relay', ${address(2, "canary-relay")}, 'Draft $json2$',
            ${`https://gov.test/r/${p2Key}`}, ${p2Key}, ${"b".repeat(64)})`

  const file = mediaKey(p1, "abcd1234-photo.png")
  await sql`
    INSERT INTO proposal_attachments (proposal_id, bucket_key, url, filename, content_type,
                                      size_bytes, sha256, uploaded_by)
    VALUES (${p1}, ${file}, ${`https://gov.test/r/${file}`}, 'photo.png', 'image/png', 1048576,
            ${"c".repeat(64)}, ${alice!.id})`

  const [c1] = await sql`
    INSERT INTO comments (proposal_id, user_id, author_address, body_markdown, created_at)
    VALUES (${p1}, ${alice!.id}, ${address(1)}, ${`First! ${TRICKY}`}, '2026-01-04 00:00:00.000002+00')
    RETURNING id`
  await sql`
    INSERT INTO comments (proposal_id, parent_id, user_id, author_address, body_markdown, edited_at)
    VALUES (${p1}, ${c1!.id}, ${bob!.id}, ${address(2, "canary-relay")}, 'A reply', NOW())`
  await sql`
    INSERT INTO comments (proposal_id, user_id, author_address, body_markdown, is_deleted)
    VALUES (${p1}, ${bob!.id}, ${address(2, "canary-relay")}, 'Removed', TRUE)`
  await sql`INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES (${c1!.id}, ${bob!.id}, '👍')`

  await sql`
    INSERT INTO security_disclosures (severity, category, summary, details, contact, network,
                                      status, ip_hash, user_agent)
    VALUES ('high', 'auth', 'Session fixation', ${TRICKY}, 'researcher@example.org', 'enjin-relay',
            'triaged', ${"d".repeat(64)}, 'curl/8.0')`

  await sql`
    INSERT INTO moderation_roles (public_key, role, granted_by)
    VALUES (${publicKey(1)}, 'moderator', ${publicKey(9)})`
  await sql`
    INSERT INTO moderation_state (target_type, target_id, proposal_id, state, reason, source, updated_at)
    VALUES ('attachment', ${file}, ${p1}, 'blurred', 'Looks like a seed phrase', 'automatic',
            '2026-04-01 00:00:00.123456+00'),
           ('comment', ${c1!.id}, NULL, 'hidden', ${TRICKY}, 'moderator', NOW())`
  await sql`
    INSERT INTO moderation_actions (target_type, target_id, proposal_id, network, referendum_index,
                                    action, reason, source, actor_public_key, actor_label)
    VALUES ('attachment', ${file}, ${p1}, 'enjin-relay', 42, 'blur', 'Seed phrase', 'automatic',
            NULL, NULL)`
  // More than one page (500 rows) of a UUID-keyed table.
  await sql`
    INSERT INTO moderation_actions (target_type, target_id, action, reason, actor_public_key, actor_label)
    SELECT 'role', ${publicKey(1)}, 'grant', 'moderator role ' || g, ${publicKey(9)}, '@admin'
      FROM generate_series(1, 1201) AS g`
  await sql`
    INSERT INTO moderation_reports (target_type, target_id, proposal_id, source, reporter_user_id,
                                    category, severity, note, details, status)
    VALUES ('proposal', ${p1}, ${p1}, 'user', ${bob!.id}, 'scam', 'high', ${TRICKY},
            ${REPORT_DETAILS}, 'open')`
  await sql`
    INSERT INTO moderation_reports (target_type, target_id, proposal_id, source, category, severity,
                                    status, resolved_at)
    VALUES ('attachment', ${file}, NULL, 'automatic', 'personal_data', 'medium', 'resolved', NOW())`
  await sql`
    INSERT INTO moderation_suspensions (public_key, until, created_by)
    VALUES (${publicKey(2)}, '2030-01-01 00:00:00+00', ${publicKey(9)})`
  await sql`
    INSERT INTO moderation_settings (key, value, updated_by)
    VALUES ('content_scan', '{"enabled": true, "model": "claude-haiku-4-5", "dailyLimit": 300}', ${publicKey(9)}),
           ('a_string', '"just text $json$"', NULL),
           ('a_null', 'null', NULL),
           ('a_number', '12345678901234567890.123456789', NULL)`
  // More than one page, keyed by (day, model, kind).
  await sql`
    INSERT INTO moderation_scan_usage (day, model, kind, checks, input_tokens, output_tokens)
    SELECT d::date, 'claude-haiku-4-5', k, 3, ${BIG_BLOCK}, 42
      FROM generate_series('2025-01-01'::date, '2025-06-01'::date, INTERVAL '1 day') AS d,
           unnest(ARRAY['images', 'pdfs', 'proposals', 'comments']) AS k`
}

const tableNames = async (pg: PGlite) =>
  (
    await pg.query<{ name: string }>(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    )
  ).rows.map((r) => r.name)

/**
 * Every row as Postgres prints the record: each value exact, and SQL NULL
 * (empty) told apart from JSON null. The progress row the backup itself
 * keeps moves on after the export, so it is left out of comparisons.
 */
const rowsOf = async (pg: PGlite, table: string) =>
  (
    await pg.query<{ r: string }>(
      `SELECT t::text AS r FROM "${table}" t
        ${table === "moderation_settings" ? "WHERE key <> 'backup_progress'" : ""}
        ORDER BY 1`,
    )
  ).rows.map((x) => x.r)

type Archive = Record<string, Uint8Array>

async function backup(): Promise<Archive> {
  const { key } = await createBackup({ includeMedia: false, createdBy: publicKey(9) })
  return unzipSync(new Uint8Array(r2.objects.get(key)!.bytes))
}

beforeEach(async () => {
  r2.resetR2()
  await seed(source.sql)
})

describe("backup round trip", () => {
  it("runs against the source database, which has rows in every table", async () => {
    expect(getSql()).toBe(source.sql)
    for (const t of await tableNames(source.pg)) {
      if (t === "_migrations") continue
      expect((await rowsOf(source.pg, t)).length, t).toBeGreaterThan(0)
    }
  })

  it("writes every table but the excluded ones, with exact values", async () => {
    const files = await backup()
    const expected = (await tableNames(source.pg)).filter(
      (t) => !["_migrations", "auth_nonces", "wallet_sessions"].includes(t),
    )
    const tableFiles = Object.keys(files).filter((p) => /^db\/.+\.json$/.test(p))
    expect(tableFiles.sort()).toEqual(expected.map((t) => `db/${t}.json`).sort())

    const manifest = JSON.parse(strFromU8(files["manifest.json"]!))
    expect(manifest.database.excluded_tables.map((t: { name: string }) => t.name)).toEqual([
      "auth_nonces",
      "wallet_sessions",
    ])
    expect(manifest.migrations.map((m: { filename: string }) => m.filename)).toEqual(
      source.migrations,
    )
    // Parents before the tables that reference them.
    const order: string[] = manifest.database.restore_order
    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b))
    before("users", "proposals")
    before("proposals", "proposal_attachments")
    before("proposals", "comments")
    before("comments", "comment_reactions")
    before("proposals", "moderation_state")

    const table = (t: string) =>
      JSON.parse(strFromU8(files[`db/${t}.json`]!)) as Record<string, unknown>[]
    const onChain = table("proposals").find((p) => p.referendum_index === 42)!
    expect(onChain.amount_planck).toBe(AMOUNT)
    expect(onChain.block_number).toBe(BIG_BLOCK)
    expect(onChain.created_at).toBe("2026-01-02T03:04:05.123456+00:00")
    expect(onChain.body_markdown).toBe(TRICKY)
    expect(table("proposal_attachments")[0]!.size_bytes).toBe("1048576")
    expect(table("moderation_actions")).toHaveLength(1202)
    expect(table("moderation_scan_usage")).toHaveLength(608)
    expect(table("moderation_scan_usage")[0]).toMatchObject({
      day: "2025-01-01",
      input_tokens: BIG_BLOCK,
    })
    const report = table("moderation_reports").find((r) => r.source === "user")!
    // JSONB stays JSON; its big number keeps every digit in the file.
    expect(strFromU8(files["db/moderation_reports.json"]!)).toContain(
      '"big": 12345678901234567890123',
    )
    expect(report.details).toMatchObject({ tag: "$json$", list: [1, 2.5, null] })
    const settings = Object.fromEntries(table("moderation_settings").map((s) => [s.key, s.value]))
    expect(settings).toMatchObject({ a_string: "just text $json$", a_null: null })

    // Nothing from the excluded tables anywhere in the archive.
    const everything = Object.values(files)
      .map((f) => strFromU8(f))
      .join("\n")
    for (const secret of ["f".repeat(64), "nonce-secret", "secret agent", "203.0.113.7"]) {
      expect(everything).not.toContain(secret)
    }
  })

  it("restores into a freshly migrated database, row for row, and a second run changes nothing", async () => {
    const files = await backup()
    const script = strFromU8(files["db/restore.sql"]!)
    // proposals holds $json$, $json1$ and $json2$, so its data gets the next free tag.
    expect(script).toContain('FROM json_populate_recordset(NULL::"proposals", $json3$[')
    expect(script).toContain('FROM json_populate_recordset(NULL::"users", $json2$[')
    expect(script).toContain('FROM json_populate_recordset(NULL::"comment_reactions", $json$[')

    for (const t of await tableNames(target.pg)) {
      if (t !== "_migrations") expect(await rowsOf(target.pg, t), t).toEqual([])
    }
    await target.pg.exec(script)
    for (const t of await tableNames(source.pg)) {
      if (t === "_migrations") continue
      const expected = ["auth_nonces", "wallet_sessions"].includes(t)
        ? []
        : await rowsOf(source.pg, t)
      expect(await rowsOf(target.pg, t), t).toEqual(expected)
    }

    await target.pg.exec(script)
    expect(await rowsOf(target.pg, "moderation_actions")).toHaveLength(1202)
    expect(await rowsOf(target.pg, "comments")).toEqual(await rowsOf(source.pg, "comments"))
  })

  it("refuses a database without the schema, in words", async () => {
    const files = await backup()
    const empty = await PGlite.create()
    try {
      await expect(empty.exec(strFromU8(files["db/restore.sql"]!))).rejects.toThrow(
        /Table \w+ is missing\. Run pnpm db:migrate first, then this script\./,
      )
    } finally {
      await empty.close()
    }
  })
})

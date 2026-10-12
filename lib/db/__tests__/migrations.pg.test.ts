import { readdir, readFile } from "node:fs/promises"
import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it, vi } from "vitest"
import { setupTestDb } from "@/test/pglite"

vi.mock("@/lib/db/client", () => import("@/test/pglite").then((m) => m.dbClientMock))

import { getSql } from "@/lib/db/client"
import { isMissingTable } from "@/lib/db/errors"

// Always from scratch here, never from the cached data directory.
const db = setupTestDb({ fresh: true })

const migrationFiles = async () =>
  (await readdir("scripts")).filter((f) => /^\d+_.+\.(sql|mjs)$/.test(f)).sort()

describe("migrations", () => {
  it("all apply cleanly to an empty database, in numeric order, each recorded once", async () => {
    const files = await migrationFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(db.migrations).toEqual(files)
    const numbers = files.map((f) => Number(f.split("_")[0]))
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))

    const ledger = await db.sql`SELECT filename FROM _migrations ORDER BY filename`
    expect(ledger.map((r) => r.filename)).toEqual(files)
  })

  it("creates every table the app queries", async () => {
    const rows = await db.sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `
    expect(rows.map((r) => r.tablename)).toEqual([
      "_migrations",
      "auth_nonces",
      "comment_reactions",
      "comments",
      "moderation_actions",
      "moderation_reports",
      "moderation_roles",
      "moderation_scan_usage",
      "moderation_settings",
      "moderation_state",
      "moderation_suspensions",
      "proposal_attachments",
      "proposals",
      "security_disclosures",
      "users",
      "wallet_sessions",
    ])
  })

  it("keeps moderation rows when a proposal is deleted (ON DELETE SET NULL, 011 + 013)", async () => {
    const rows = await db.sql`
      SELECT conrelid::regclass::text AS tbl, confdeltype
        FROM pg_constraint
       WHERE contype = 'f' AND confrelid = 'proposals'::regclass
         AND conrelid::regclass::text LIKE 'moderation_%'
       ORDER BY 1
    `
    expect(rows).toEqual([
      { tbl: "moderation_actions", confdeltype: "n" },
      { tbl: "moderation_reports", confdeltype: "n" },
      { tbl: "moderation_state", confdeltype: "n" },
    ])
  })

  it("makes handles unique per network, not globally (009)", async () => {
    const rows = await db.sql`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexdef LIKE '%handle%'
    `
    expect(rows.map((r) => r.indexdef)).toEqual([
      expect.stringMatching(
        /UNIQUE INDEX users_network_handle_unique .*\(network, handle\) WHERE \(handle IS NOT NULL\)/,
      ),
    ])
  })

  it("re-applies cleanly where the file says it is idempotent", async () => {
    const files = await migrationFiles()
    const idempotent: string[] = []
    for (const f of files.filter((f) => f.endsWith(".sql"))) {
      const body = await readFile(`scripts/${f}`, "utf8")
      if (
        !/idempotent/i.test(
          body
            .split("\n")
            .filter((l) => l.startsWith("--"))
            .join("\n"),
        )
      ) {
        continue
      }
      idempotent.push(f)
      await expect(db.pg.exec(body), f).resolves.toBeDefined()
    }
    expect(idempotent).toEqual([
      "009_users_per_network_handle.sql",
      "011_moderation.sql",
      "012_moderation_settings.sql",
      "013_moderation_keep_state.sql",
      "014_drop_proposer_signature.sql",
    ])
  })

  it("drops the never-written proposals.proposer_signature (014)", async () => {
    const rows = await db.sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'proposals'
    `
    const columns = rows.map((r) => r.column_name)
    expect(columns).toContain("json_sha256")
    expect(columns).not.toContain("proposer_signature")
  })
})

describe("test client", () => {
  it("is an in-process PGlite behind getSql(), never a configured server", () => {
    expect(db.pg).toBeInstanceOf(PGlite)
    expect(getSql()).toBe(db.sql)
  })

  it("passes values as parameters and returns rows shaped like Neon's", async () => {
    const at = new Date("2026-01-02T03:04:05.678Z")
    const [row] = await db.sql`
      SELECT ${"x'; DROP TABLE users; --"}::text AS text,
             ${42}::int AS int4,
             ${2n ** 62n}::bigint AS int8,
             ${"12345678901234567890"}::numeric AS numeric,
             ${at}::timestamptz AS ts,
             ${JSON.stringify({ a: [1, 2] })}::jsonb AS json,
             ${["a", 'b"c', null]}::text[] AS arr,
             ${[3, 1]}::int[] AS ints,
             TRUE AS bool,
             NULL::text AS nothing
    `
    expect(row).toEqual({
      text: "x'; DROP TABLE users; --",
      int4: 42,
      int8: "4611686018427387904",
      numeric: "12345678901234567890",
      ts: at,
      json: { a: [1, 2] },
      arr: ["a", 'b"c', null],
      ints: [3, 1],
      bool: true,
      nothing: null,
    })
  })

  it("rejects with the Postgres error message and code", async () => {
    const err = await db.sql`SELECT * FROM no_such_table`.catch((e: unknown) => e)
    expect(err).toMatchObject({
      code: "42P01",
      message: expect.stringContaining('relation "no_such_table" does not exist'),
    })
    // How routes tell "migration not applied yet" from other failures.
    expect(isMissingTable(err)).toBe(true)
    expect(isMissingTable(await db.sql`SELECT 1/0`.catch((e: unknown) => e))).toBe(false)
  })
})

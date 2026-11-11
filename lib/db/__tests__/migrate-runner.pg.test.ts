/**
 * scripts/run-migrations.mjs on a database whose migrations were applied by
 * hand (pasted into a SQL editor, so there is no ledger), the state the 2.0
 * upgrade starts from: the runner must not re-run 004 on tables that exist,
 * and `--baseline` records what is in place so the rest applies.
 */
import { readdir, readFile } from "node:fs/promises"
import { PGlite } from "@electric-sql/pglite"
import { citext } from "@electric-sql/pglite/contrib/citext"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { describe, expect, it } from "vitest"
import { migrate } from "../../../scripts/run-migrations.mjs"

type Row = Record<string, unknown>

/** Neon's client shape over PGlite: a tagged template, and `query` for a whole file. */
function clientFor(pg: PGlite) {
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), "")
    return (await pg.query<Row>(text, values)).rows
  }
  return Object.assign(tag, {
    query: async (text: string): Promise<Row[]> => {
      await pg.exec(text)
      return []
    },
  })
}

const numberOf = (f: string) => Number(f.slice(0, 3))
const files = async () => (await readdir("scripts")).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
const ledger = async (pg: PGlite) =>
  (
    await pg.query<{ filename: string }>("SELECT filename FROM _migrations ORDER BY filename")
  ).rows.map((r) => r.filename)
const proposalColumns = async (pg: PGlite) =>
  (
    await pg.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'proposals'",
    )
  ).rows.map((r) => r.column_name)

/** A draft as 1.0 stores it: the insert names proposer_signature. */
const insertAsV1 = (pg: PGlite, index: number) =>
  pg.exec(`
    INSERT INTO proposals (network, referendum_index, proposer_address, title, json_url, json_key, json_sha256, proposer_signature)
    VALUES ('enjin-relay', ${index}, 'enA', 'Public #${index}', 'u', 'k${index}', 's', NULL)
  `)

describe("pnpm db:migrate on a database migrated by hand", () => {
  it("stops before running anything, then --baseline records what is in place", async () => {
    const pg = new PGlite({ extensions: { citext, pgcrypto } })
    const all = await files()
    const byHand = all.filter((f) => numberOf(f) <= 13)
    for (const f of byHand) await pg.exec(await readFile(`scripts/${f}`, "utf8"))
    await insertAsV1(pg, 0)
    const sql = clientFor(pg)
    const lines: string[] = []
    const log = (l: string) => lines.push(l)

    await expect(migrate(sql, { until: "014", log })).rejects.toThrow(
      /applied by hand[\s\S]*--baseline 013/,
    )
    expect(await ledger(pg)).toEqual([])
    expect(await proposalColumns(pg)).not.toContain("referenda_pallet")

    await migrate(sql, { baseline: "013", until: "014", log })
    expect(lines.filter((l) => l.endsWith("(recorded as applied, not run)"))).toHaveLength(
      byHand.length,
    )
    expect(lines).toContain("+ 014_fellowship_referenda.sql")
    expect(lines).toContain("- 015_drop_proposer_signature.sql (held back by --until 014)")
    expect(await ledger(pg)).toEqual(all.filter((f) => numberOf(f) <= 14))
    const rows = await pg.query<{ referenda_pallet: string }>(
      "SELECT referenda_pallet FROM proposals",
    )
    expect(rows.rows).toEqual([{ referenda_pallet: "referenda" }])
    // 1.0 keeps working against 014.
    await insertAsV1(pg, 1)

    await migrate(sql, { log })
    expect(lines).toContain("+ 015_drop_proposer_signature.sql")
    expect(await ledger(pg)).toEqual(all)
    expect(await proposalColumns(pg)).not.toContain("proposer_signature")

    // And again: nothing left to do.
    lines.length = 0
    await migrate(sql, { log })
    expect(lines.filter((l) => l.startsWith("+ "))).toEqual([])
    await pg.close()
  }, 60_000)

  it("refuses --baseline on an empty database and migrates it from scratch without it", async () => {
    const pg = new PGlite({ extensions: { citext, pgcrypto } })
    const sql = clientFor(pg)
    await expect(migrate(sql, { baseline: "013", log: () => {} })).rejects.toThrow(
      /this one is empty/,
    )
    await migrate(sql, { log: () => {} })
    expect(await ledger(pg)).toEqual(await files())
    await pg.close()
  }, 60_000)
})

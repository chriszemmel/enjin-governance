/**
 * The database side of a backup: which tables there are, the order they
 * restore in (parents first), and every row as exact JSON.
 *
 * Rows are turned into JSON by Postgres itself (row_to_json) and kept as
 * that text, so no value passes through a JavaScript number: BIGINT and
 * NUMERIC are cast to strings, timestamps come out as ISO 8601 with their
 * microseconds and offset, JSONB stays JSON.
 *
 * Tables are found in the catalog rather than listed here, so a table a
 * later migration adds is backed up without a change to this file. Only
 * the tables in EXCLUDED_TABLES are left out.
 */

import "server-only"
import { getSql } from "@/lib/db/client"
import { isMissingTable } from "@/lib/db/errors"
import { ident, type BackupColumn } from "./restore-sql"

/** Left out of every backup, with the reason the manifest gives. */
export const EXCLUDED_TABLES: Record<string, string> = {
  auth_nonces: "Short-lived secrets: sign-in challenges that expire within minutes.",
  wallet_sessions:
    "Short-lived secrets: sign-in session tokens (hashed), with IP addresses and user agents. Everyone signs in again after a restore.",
}

/** The migration ledger goes into manifest.json, not db/. */
const LEDGER = "_migrations"

/** Rows per query, so no single response holds a whole large table. */
const PAGE_ROWS = 500

type TableInfo = {
  name: string
  columns: BackupColumn[]
  primaryKey: string[]
  /** Tables this one references (not itself). */
  parents: string[]
}

export type MigrationEntry = { filename: string; applied_at: string }

/** Every table to back up, in the order they restore in: each after the tables it references. */
export async function readTables(): Promise<TableInfo[]> {
  const rows = (await getSql()`
    SELECT c.relname AS name,
           COALESCE((
             SELECT json_agg(json_build_object(
                      'name', a.attname,
                      'type', format_type(a.atttypid, a.atttypmod),
                      'notNull', a.attnotnull,
                      'generated', a.attgenerated IN ('s', 'v')
                    ) ORDER BY a.attnum)
               FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
           ), '[]'::json) AS columns,
           COALESCE((
             SELECT json_agg(a.attname ORDER BY k.ord)
               FROM pg_constraint pk
               CROSS JOIN LATERAL unnest(pk.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
              WHERE pk.conrelid = c.oid AND pk.contype = 'p'
           ), '[]'::json) AS primary_key,
           COALESCE((
             SELECT json_agg(DISTINCT p.relname)
               FROM pg_constraint fk
               JOIN pg_class p ON p.oid = fk.confrelid
              WHERE fk.conrelid = c.oid AND fk.contype = 'f' AND fk.confrelid <> c.oid
           ), '[]'::json) AS parents
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
     ORDER BY c.relname
  `) as { name: string; columns: BackupColumn[]; primary_key: string[]; parents: string[] }[]
  return restoreOrder(
    rows
      .filter((r) => r.name !== LEDGER && !(r.name in EXCLUDED_TABLES))
      .map((r) => ({
        name: r.name,
        columns: r.columns,
        primaryKey: r.primary_key,
        parents: r.parents,
      })),
  )
}

/**
 * Parents first; ties (and a cycle, which the schema doesn't have) in name
 * order. References to tables outside the backup don't hold anything up.
 */
function restoreOrder(tables: TableInfo[]): TableInfo[] {
  const names = new Set(tables.map((t) => t.name))
  const left = [...tables].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const placed = new Set<string>()
  const out: TableInfo[] = []
  while (left.length > 0) {
    const ready = left.findIndex((t) => t.parents.every((p) => placed.has(p) || !names.has(p)))
    const [next] = left.splice(Math.max(ready, 0), 1)
    placed.add(next.name)
    out.push(next)
  }
  return out
}

/** The migration ledger, or null when the database has none (migrations applied by hand). */
export async function readMigrations(): Promise<MigrationEntry[] | null> {
  try {
    return (await getSql()`
      SELECT filename, to_json(applied_at) #>> '{}' AS applied_at
        FROM _migrations ORDER BY filename
    `) as MigrationEntry[]
  } catch (err) {
    if (isMissingTable(err)) return null
    throw err
  }
}

/** BIGINT and NUMERIC as strings: as JSON numbers they would lose digits in JavaScript. */
function valueExpr(c: BackupColumn): string {
  const col = `t.${ident(c.name)}`
  if (!/^(bigint|numeric|money)\b/.test(c.type)) return col
  return c.type.endsWith("[]") ? `${col}::text[]` : `${col}::text`
}

/**
 * Every row of a table, one JSON object each, in primary-key order. Read a
 * page at a time, each page after the last key of the one before.
 */
export async function readRows(t: TableInfo): Promise<string[]> {
  const sql = getSql()
  const values = t.columns.map((c) => `${valueExpr(c)} AS ${ident(c.name)}`).join(", ")
  const keys = t.primaryKey.map((k, i) => `, t.${ident(k)}::text AS k${i}`).join("")
  const base = `SELECT row_to_json(x)::text AS j${keys} FROM ${ident(t.name)} AS t CROSS JOIN LATERAL (SELECT ${values}) AS x`
  if (t.primaryKey.length === 0) {
    return ((await sql.query(base)) as { j: string }[]).map((r) => r.j)
  }

  const order = t.primaryKey.map((k) => `t.${ident(k)}`).join(", ")
  const types = t.primaryKey.map((k) => t.columns.find((c) => c.name === k)?.type ?? "text")
  const after = `(${order}) > (${types.map((type, i) => `CAST($${i + 1} AS ${type})`).join(", ")})`
  const rows: string[] = []
  let last: string[] | null = null
  for (;;) {
    const page = (await sql.query(
      `${base}${last ? ` WHERE ${after}` : ""} ORDER BY ${order} LIMIT ${PAGE_ROWS}`,
      last ?? [],
    )) as Record<string, string>[]
    for (const r of page) rows.push(r.j)
    if (page.length < PAGE_ROWS) return rows
    const end = page[page.length - 1]
    last = t.primaryKey.map((_, i) => end[`k${i}`])
  }
}

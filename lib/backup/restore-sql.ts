/**
 * db/restore.sql: puts a backup's rows back into a freshly migrated
 * database (`pnpm db:migrate` first), in one transaction, parents before
 * the tables that reference them.
 *
 * Each table is one statement that reads the same JSON as db/<table>.json:
 *
 *   INSERT INTO "users" ("id", …) SELECT r."id", … FROM
 *     json_populate_recordset(NULL::"users", $json$[…]$json$) AS r
 *     ON CONFLICT DO NOTHING;
 *
 * The JSON sits in a dollar-quoted string, whose content is never escaped
 * or interpreted, so the only thing that could end it early is its own tag:
 * each table gets a tag that doesn't occur in its JSON.
 */

export type BackupColumn = {
  name: string
  /** As format_type() names it, e.g. "bigint" or "timestamp with time zone". */
  type: string
  notNull: boolean
  /** Generated columns are computed by the database and never inserted. */
  generated: boolean
}

export type BackupTable = {
  name: string
  columns: BackupColumn[]
  /** One JSON object per row. */
  rows: string[]
}

export const ident = (name: string) => `"${name.replace(/"/g, '""')}"`
const literal = (text: string) => `'${text.replace(/'/g, "''")}'`
/** For a `--` comment: nothing that could end the line. */
const commentText = (text: string) => text.replace(/[^\x20-\x7e]/g, "?")

/** A dollar-quote tag (`$json$`, `$json1$`, …) that doesn't occur in `text`. */
export function dollarTag(text: string): string {
  let tag = "$json$"
  for (let n = 1; text.includes(tag); n++) tag = `$json${n}$`
  return tag
}

/** A table's rows as one JSON array, one row per line. */
export function tableJson(rows: string[]): string {
  return rows.length === 0 ? "[]\n" : `[\n${rows.join(",\n")}\n]\n`
}

/**
 * The value to insert for a column. A json/jsonb column that is NOT NULL
 * can't have held SQL NULL, so a null in the JSON is the JSON value null.
 */
function selectValue(c: BackupColumn): string {
  const value = `r.${ident(c.name)}`
  if (c.notNull && /^jsonb?$/.test(c.type)) return `COALESCE(${value}, 'null'::${c.type})`
  return value
}

/** The script, piece by piece (one piece per table), for streaming into the archive. */
export function* restoreSql(
  tables: BackupTable[],
  info: { createdAt: string; appVersion: string },
): Iterable<string> {
  yield [
    "-- Enjin Governance backup: restore script",
    `-- Backup created ${info.createdAt}, app version ${info.appVersion}.`,
    "--",
    "-- Restores the data into a freshly migrated database. First apply the",
    "-- schema from the same version of the app (`pnpm db:migrate`), then:",
    "--",
    '--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/restore.sql',
    "--",
    "-- Everything runs in one transaction: either all rows are restored or",
    "-- none. Rows that already exist are left as they are.",
    "",
    "SET client_encoding = 'UTF8';",
    "",
    "BEGIN;",
    "",
    "DO $check$",
    "DECLARE t text;",
    "BEGIN",
    `  FOREACH t IN ARRAY ARRAY[${tables.map((t) => literal(t.name)).join(", ")}]::text[] LOOP`,
    "    IF to_regclass(format('public.%I', t)) IS NULL THEN",
    "      RAISE EXCEPTION 'Table % is missing. Run pnpm db:migrate first, then this script.', t;",
    "    END IF;",
    "  END LOOP;",
    "END",
    "$check$;",
    "",
    "",
  ].join("\n")

  for (const t of tables) {
    if (t.rows.length === 0) {
      yield `-- ${commentText(t.name)}: no rows\n\n`
      continue
    }
    const columns = t.columns.filter((c) => !c.generated)
    const json = tableJson(t.rows)
    const tag = dollarTag(json)
    yield [
      `-- ${commentText(t.name)}: ${t.rows.length} row${t.rows.length === 1 ? "" : "s"}`,
      `INSERT INTO ${ident(t.name)} (${columns.map((c) => ident(c.name)).join(", ")})`,
      `SELECT ${columns.map(selectValue).join(", ")}`,
      `FROM json_populate_recordset(NULL::${ident(t.name)}, ${tag}${json}${tag}) AS r`,
      "ON CONFLICT DO NOTHING;",
      "",
      "",
    ].join("\n")
  }

  yield "COMMIT;\n"
}

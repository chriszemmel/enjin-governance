#!/usr/bin/env node
/**
 * Apply every `scripts/NNN_*.{sql,mjs}` file in numeric order against
 * the unpooled Neon URL. Idempotent on already-applied files via a
 * small `_migrations` ledger table (one row per filename).
 *
 * Usage:
 *   pnpm db:migrate                  every pending file
 *   pnpm db:migrate --until 014      only pending files numbered up to 014
 *   pnpm db:migrate --baseline 013   record the files up to 013 as applied
 *                                    without running them, then go on
 *
 * `--until` holds back a migration that must wait for a deploy, such as
 * 015 (drop a column the previous release still writes): apply the
 * earlier files before deploying, the rest after.
 *
 * `--baseline` is for a database whose migrations were applied by hand
 * (pasted into a SQL editor), so its ledger is empty: the first files are
 * not idempotent and would fail on tables that already exist. Without it
 * the runner stops on such a database before running anything. Name the
 * last file that is already in place.
 *
 * Reads `DATABASE_URL_UNPOOLED` from the environment. If that isn't
 * set it falls back to `DATABASE_URL` - but you should prefer the
 * unpooled URL for DDL, since the Neon pooler drops sessions
 * mid-transaction on long DDL statements.
 *
 * `.sql` files are handed to the driver as one multi-statement call.
 * `.mjs` files must `export default async function (sql)` and own
 * their own statement ordering - used when a migration needs JS-side
 * logic Postgres can't express on its own (e.g. SS58 decode for the
 * users.public_key backfill).
 */

import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { neon } from "@neondatabase/serverless"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SCRIPTS_DIR = resolve(__dirname)

/** A flag's numeric value (`--until 014` / `--until=014`), or null when it isn't given. */
function parseNumberFlag(argv, flag) {
  const i = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`))
  if (i < 0) return null
  const raw = argv[i].includes("=") ? argv[i].slice(flag.length + 1) : argv[i + 1]
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(`${flag} needs a migration number, e.g. ${flag} 014`)
  }
  return raw
}

const numberOf = (filename) => Number(filename.match(/^\d+/)[0])

async function ensureLedger(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

async function appliedFilenames(sql) {
  const rows = await sql`SELECT filename FROM _migrations`
  return new Set(rows.map((r) => r.filename))
}

/** Whether the app's tables are there (004 creates `proposals`). */
async function hasAppTables(sql) {
  const rows = await sql`SELECT to_regclass('proposals') IS NOT NULL AS present`
  return rows[0]?.present === true
}

/**
 * Apply the pending migration files in `dir` through `sql` (Neon's HTTP
 * client, or anything shaped like it). `until` and `baseline` are migration
 * numbers as typed ("014") or null. Throws with a readable message.
 *
 * @param {any} sql
 * @param {{ until?: string | null, baseline?: string | null, dir?: string, log?: (line: string) => void }} [options]
 * @returns {Promise<void>}
 */
export async function migrate(
  sql,
  { until = null, baseline = null, dir = SCRIPTS_DIR, log = console.log } = {},
) {
  const untilNumber = until == null ? null : Number(until)
  const baselineNumber = baseline == null ? null : Number(baseline)

  await ensureLedger(sql)
  const applied = await appliedFilenames(sql)

  const all = await readdir(dir)
  const migrationFiles = all.filter((f) => /^\d+_.+\.(sql|mjs)$/.test(f)).sort()

  if (migrationFiles.length === 0) {
    log("No migration files found.")
    return
  }

  const tablesExist = await hasAppTables(sql)

  if (baselineNumber != null) {
    if (!tablesExist) {
      throw new Error(
        "--baseline is for a database that already has the app's tables; this one is empty. Run pnpm db:migrate without it.",
      )
    }
    for (const f of migrationFiles) {
      if (applied.has(f) || numberOf(f) > baselineNumber) continue
      await sql`INSERT INTO _migrations (filename) VALUES (${f}) ON CONFLICT (filename) DO NOTHING`
      applied.add(f)
      log(`~ ${f} (recorded as applied, not run)`)
    }
  } else if (applied.size === 0 && tablesExist) {
    throw new Error(
      [
        "This database has the app's tables but an empty migrations ledger, so its",
        "migrations were applied by hand. Nothing was run. Record what is already in",
        "place first, naming the last file that is applied, e.g.:",
        "  pnpm db:migrate --baseline 013 --until 014",
      ].join("\n"),
    )
  }

  for (const f of migrationFiles) {
    if (applied.has(f)) {
      log(`= ${f} (already applied)`)
      continue
    }
    if (untilNumber != null && numberOf(f) > untilNumber) {
      log(`- ${f} (held back by --until ${until})`)
      continue
    }
    const path = join(dir, f)
    log(`+ ${f}`)
    try {
      if (f.endsWith(".sql")) {
        // Neon's HTTP driver runs one statement per call when using
        // `sql.query`. The migration files are intentionally wrapped
        // in BEGIN/COMMIT so we hand the whole script off as a
        // single multi-statement call.
        const body = await readFile(path, "utf8")
        await sql.query(body)
      } else {
        const mod = await import(pathToFileURL(path).href)
        if (typeof mod.default !== "function") {
          throw new Error(
            `${f} must export default async function(sql) - got ${typeof mod.default}`,
          )
        }
        await mod.default(sql)
      }
      await sql`INSERT INTO _migrations (filename) VALUES (${f})`
    } catch (e) {
      throw new Error(`${f} failed: ${e.message ?? e}`)
    }
  }

  log(until != null ? `Migrations up to ${until} applied.` : "Migrations up to date.")
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set")
  const argv = process.argv.slice(2)
  await migrate(neon(url), {
    until: parseNumberFlag(argv, "--until"),
    baseline: parseNumberFlag(argv, "--baseline"),
  })
}

// Only when run as a script: tests import `migrate`.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
}

#!/usr/bin/env node
/**
 * Apply every `scripts/NNN_*.{sql,mjs}` file in numeric order against
 * the unpooled Neon URL. Idempotent on already-applied files via a
 * small `_migrations` ledger table (one row per filename).
 *
 * Usage:
 *   pnpm db:migrate
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

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set")
  process.exit(1)
}

const sql = neon(url)

async function ensureLedger() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

async function appliedFilenames() {
  const rows = await sql`SELECT filename FROM _migrations`
  return new Set(rows.map((r) => r.filename))
}

async function main() {
  await ensureLedger()
  const applied = await appliedFilenames()

  const all = await readdir(SCRIPTS_DIR)
  const migrationFiles = all
    .filter((f) => /^\d+_.+\.(sql|mjs)$/.test(f))
    .sort()

  if (migrationFiles.length === 0) {
    console.log("No migration files found.")
    return
  }

  for (const f of migrationFiles) {
    if (applied.has(f)) {
      console.log(`= ${f} (already applied)`)
      continue
    }
    const path = join(SCRIPTS_DIR, f)
    console.log(`+ ${f}`)
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
      console.error(`  failed: ${e.message ?? e}`)
      process.exit(1)
    }
  }

  console.log("Migrations up to date.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

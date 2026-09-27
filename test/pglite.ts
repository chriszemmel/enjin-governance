/**
 * Real Postgres for lib/db tests: an in-process PGlite (Postgres compiled to
 * WASM) with every migration in scripts/ applied the way
 * scripts/run-migrations.mjs applies them, behind a client that behaves like
 * the Neon HTTP one `getSql()` returns.
 *
 * In a test file:
 *
 *   vi.mock("@/lib/db/client", () => import("@/test/pglite").then((m) => m.dbClientMock))
 *   const db = setupTestDb()
 *
 * One database per test file, emptied before every test. Building one
 * (initdb + migrations) takes about 2s of CPU, so the migrated data directory
 * is kept in the OS temp dir, keyed by the migration files and the PGlite
 * version, and later files load it in about 0.5s. Any cache problem falls
 * back to building afresh; `setupTestDb({ fresh: true })` always does.
 *
 * Fidelity to Neon's `neon()` client (@neondatabase/serverless 1.x):
 *  - Called as a tagged template; each interpolation becomes a $n parameter
 *    (never spliced into the SQL) and the promise resolves to the rows array.
 *  - Parameters are turned into text the way Neon does (pg's prepareValue):
 *    arrays become array literals, plain objects JSON, Dates timestamps, and
 *    Postgres infers each parameter's type.
 *  - Result values are parsed from their text form with the same pg-types
 *    parsers Neon uses, so BIGINT and NUMERIC come back as strings,
 *    TIMESTAMPTZ as Date and JSONB parsed.
 *  - Every statement runs on its own (autocommit), as each Neon HTTP call does.
 *  - Errors are Postgres errors with the server's message and `code`.
 * Nested sql`` fragments and sql.unsafe/transaction are not supported: lib/db
 * doesn't use them.
 */

import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { citext } from "@electric-sql/pglite/contrib/citext"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { types } from "@neondatabase/serverless"
import { encodeAddress } from "@polkadot/util-crypto"
import { afterAll, beforeAll, beforeEach } from "vitest"
import { CHAINS, type ChainId } from "@/lib/chain/chains"
import type { CreateProposalDraft } from "@/lib/db/proposals"

type Row = Record<string, unknown>

type NeonLikeSql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
  /** Conventional call with $1..$n placeholders, as `sql.query` in the migration runner. */
  query: (text: string, params?: unknown[]) => Promise<Row[]>
}

const SCRIPTS_DIR = fileURLToPath(new URL("../scripts/", import.meta.url))
const MIGRATION_FILE = /^\d+_.+\.(sql|mjs)$/
const EXTENSIONS = { citext, pgcrypto }
const CACHE_DIR = path.join(tmpdir(), "enjin-governance-pglite")

/** The files scripts/run-migrations.mjs applies, in its order. */
const migrationFiles = async () =>
  (await readdir(SCRIPTS_DIR)).filter((f) => MIGRATION_FILE.test(f)).sort()

/** Where the migrated data directory for these files and this PGlite build is kept. */
async function cacheFile(files: string[]): Promise<string> {
  const pkg = path.join(
    path.dirname(createRequire(import.meta.url).resolve("@electric-sql/pglite")),
    "../package.json",
  )
  const hash = createHash("sha256").update(await readFile(pkg))
  for (const f of files) hash.update(f).update(await readFile(`${SCRIPTS_DIR}${f}`))
  return path.join(CACHE_DIR, `${hash.digest("hex").slice(0, 24)}.tar`)
}

/** Only ever saves time: failures are ignored, and a reader never sees half a file. */
async function saveCache(file: string, dump: Blob): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    for (const old of await readdir(CACHE_DIR)) {
      if (old.endsWith(".tar") && old !== path.basename(file)) {
        await rm(path.join(CACHE_DIR, old), { force: true })
      }
    }
    const tmp = `${file}.${process.pid}.${randomUUID()}`
    await writeFile(tmp, new Uint8Array(await dump.arrayBuffer()))
    await rename(tmp, file)
  } catch {
    // Next run builds afresh.
  }
}

const isBinary = (v: unknown): v is ArrayBufferView => ArrayBuffer.isView(v)

/** A parameter as the text Neon sends (pg's prepareValue), or null. */
function toParam(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (isBinary(v)) return `\\x${Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("hex")}`
  // pg sends local time with its offset; the ISO form names the same instant.
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return arrayLiteral(v)
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

function arrayLiteral(items: unknown[]): string {
  const parts = items.map((x) => {
    if (x === null || x === undefined) return "NULL"
    if (Array.isArray(x)) return arrayLiteral(x)
    return `"${toParam(x)!.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  })
  return `{${parts.join(",")}}`
}

let active: TestDb | null = null

/** Stand-in for `@/lib/db/client`, bound to the running test database. */
export const dbClientMock = {
  getSql: () => {
    if (!active) throw new Error("Db unavailable: no test database is running")
    return active.sql
  },
  isDbConfigured: () => true,
}

class TestDb {
  #pg: PGlite | null = null
  #tables: string[] = []
  /** Pass-through for every type, so values reach the Neon parsers as text. */
  #raw: Record<number, (v: string) => string> = {}
  /** When the last statement finished (ms), see #run. */
  #lastMs = 0

  /** Migration files applied, in order. */
  migrations: string[] = []

  /**
   * Up to this many ms of random delay before each statement, so concurrent
   * calls interleave differently. Back to 0 before every test.
   */
  jitterMs = 0

  readonly sql: NeonLikeSql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => this.#template(strings, values),
    { query: (text: string, params: unknown[] = []) => this.#run(text, params) },
  )

  get pg(): PGlite {
    if (!this.#pg) throw new Error("The test database isn't started")
    return this.#pg
  }

  /** Start a migrated database: from the cache, or afresh (always when `fresh`). */
  async start({ fresh = false } = {}): Promise<void> {
    const files = await migrationFiles()
    const cache = await cacheFile(files)
    const dump = fresh ? null : await readFile(cache).catch(() => null)
    if (dump) {
      try {
        this.#pg = await PGlite.create({
          extensions: EXTENSIONS,
          loadDataDir: new Blob([new Uint8Array(dump)]),
        })
        const ledger = await this.pg.query<{ filename: string }>(
          "SELECT filename FROM _migrations ORDER BY filename",
        )
        this.migrations = ledger.rows.map((r) => r.filename)
      } catch {
        await this.#pg?.close().catch(() => undefined)
        this.#pg = null
      }
    }
    if (!this.#pg) {
      this.#pg = await PGlite.create({ extensions: EXTENSIONS })
      await this.#loadTypes()
      this.migrations = await this.#migrate(files)
      await saveCache(cache, await this.pg.dumpDataDir("none"))
    }
    await this.#loadTypes() // including types the migrations created (citext)
    const tables = await this.pg.query<{ name: string }>(
      `SELECT quote_ident(tablename) AS name FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_migrations'`,
    )
    this.#tables = tables.rows.map((r) => r.name)
  }

  /**
   * Empty every table (the migration ledger stays). DELETE is ~15x faster
   * than TRUNCATE in PGlite; with foreign-key triggers off the order doesn't
   * matter, and every row goes anyway.
   */
  async reset(): Promise<void> {
    this.jitterMs = 0
    await this.pg.exec(`
      SET session_replication_role = replica;
      ${this.#tables.map((t) => `DELETE FROM ${t};`).join("\n")}
      SET session_replication_role = DEFAULT;
    `)
  }

  async stop(): Promise<void> {
    await this.#pg?.close()
    this.#pg = null
  }

  async #loadTypes(): Promise<void> {
    const res = await this.pg.query<{ oid: number }>("SELECT oid::int AS oid FROM pg_type")
    this.#raw = Object.fromEntries(res.rows.map((r) => [r.oid, (v: string) => v]))
  }

  /** scripts/run-migrations.mjs: ledger, numeric file order, each file once, whole file per call. */
  async #migrate(files: string[]): Promise<string[]> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    const applied = new Set(
      (await this.sql`SELECT filename FROM _migrations`).map((r) => r.filename),
    )
    for (const f of files) {
      if (applied.has(f)) continue
      const file = `${SCRIPTS_DIR}${f}`
      try {
        if (f.endsWith(".sql")) {
          // Simple-query protocol: the whole multi-statement file in one call.
          await this.pg.exec(await readFile(file, "utf8"))
        } else {
          const mod = (await import(pathToFileURL(file).href)) as { default: unknown }
          if (typeof mod.default !== "function") throw new Error("no default export function")
          await (mod.default as (sql: NeonLikeSql) => Promise<void>)(this.sql)
        }
      } catch (e) {
        throw new Error(`Migration ${f} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
      await this.sql`INSERT INTO _migrations (filename) VALUES (${f})`
    }
    return files
  }

  async #template(strings: TemplateStringsArray, values: unknown[]): Promise<Row[]> {
    let text = strings[0]!
    values.forEach((v, i) => {
      if (typeof (v as PromiseLike<unknown> | null)?.then === "function") {
        throw new Error("Nested sql`` fragments aren't supported by the test client")
      }
      text += `$${i + 1}${isBinary(v) ? "::bytea" : ""}${strings[i + 1]}`
    })
    return this.#run(text, values)
  }

  async #run(text: string, params: unknown[]): Promise<Row[]> {
    if (this.jitterMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * this.jitterMs))
    }
    // PGlite's clock only has millisecond resolution (NOW() always ends in
    // .xxx000), so statements in the same millisecond would share a
    // timestamp and ORDER BY created_at would tie. On Postgres they're
    // microseconds apart, so each statement starts in a later millisecond
    // than the previous one finished.
    while (Date.now() <= this.#lastMs) {
      // spins for under a millisecond
    }
    const res = await this.pg
      .query<unknown[]>(text, params.map(toParam), {
        rowMode: "array",
        parsers: this.#raw,
        serializers: this.#raw,
      })
      .finally(() => {
        this.#lastMs = Date.now()
      })
    const parse = res.fields.map(
      (f) => types.getTypeParser(f.dataTypeID, "text") as (v: string) => unknown,
    )
    return res.rows.map((row) =>
      Object.fromEntries(
        row.map((v, i) => [res.fields[i]!.name, v === null ? null : parse[i]!(v as string)]),
      ),
    )
  }
}

/**
 * A migrated database for this test file, emptied before every test, and
 * the one `dbClientMock.getSql()` returns while it runs. `fresh` skips the
 * cache and applies every migration to an empty database.
 */
export function setupTestDb(options: { fresh?: boolean } = {}): TestDb {
  const db = new TestDb()
  beforeAll(async () => {
    await db.start(options)
    active = db
  }, 60_000)
  beforeEach(() => db.reset())
  afterAll(async () => {
    active = null
    await db.stop()
  })
  return db
}

// ---- fixtures ----------------------------------------------------------------

/** A valid draft for insertProposalDraft, with a fresh id unless given one. */
export function draftFixture(over: Partial<CreateProposalDraft> = {}): CreateProposalDraft {
  const id = over.id ?? randomUUID()
  const network = over.network ?? "enjin-relay"
  const key = `proposals/${network}/${id}/proposal-aaaaaaaaaaaaaaaa.json`
  return {
    id,
    network,
    proposerUserId: null,
    proposerAddress: "enProposerAddress",
    title: "Fund the thing",
    summary: null,
    bodyMarkdown: "Why it matters.",
    track: null,
    beneficiary: null,
    amountPlanck: null,
    jsonUrl: `https://cdn.example/${key}`,
    jsonKey: key,
    jsonSha256: "a".repeat(64),
    proposerSignature: null,
    preimageHash: null,
    preimageLen: null,
    remarkPayload: null,
    ...over,
  }
}

/** Bucket key of one of a proposal's uploads. */
export const mediaKey = (proposalId: string, name = "photo.png", network = "enjin-relay") =>
  `proposals/${network}/${proposalId}/media/${name}`

/** A 32-byte public key as moderation tables store it. */
export const publicKey = (n: number) => `0x${n.toString(16).padStart(64, "0")}`

/** A real SS58 address for key number `n` (1-255) in a network's format. */
export const address = (n: number, network: ChainId = "enjin-relay") =>
  encodeAddress(new Uint8Array(32).fill(n), CHAINS[network].ss58Prefix)

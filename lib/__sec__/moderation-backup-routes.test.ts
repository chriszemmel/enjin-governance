/**
 * Backups: POST/GET/DELETE /api/moderation/backup and GET
 * /api/moderation/backup/download. Admins only (moderators and everyone
 * else refused, before any storage call); at most one backup every 10
 * minutes across servers; only keys of the shape the route creates, under
 * backups/, are listed, downloaded or deleted, and /r never serves them;
 * downloads are a redirect to a link signed for minutes; the newest 5 are
 * kept. The archive is unzipped here and checked: manifest, every table
 * but the excluded ones, sha256 of every file, proposal JSON always and
 * uploaded files only when asked (stored, not deflated). No response and
 * no file in the archive carries a secret.
 *
 * Real route handlers, the real role check, real Postgres (PGlite) and
 * the real archive code; only the session, R2 (multipart upload included)
 * and the URL signer are faked.
 */
import { createHash, randomBytes } from "node:crypto"
import { strFromU8, unzipSync } from "fflate"
import { NextRequest } from "next/server"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { address, setupTestDb } from "@/test/pglite"

const ADMIN = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const MOD = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const USER = "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH"

const DATABASE_URL =
  "postgres://neondb_owner:db-secret-pw@ep-cool-1.eu-central-1.aws.neon.tech/neondb"

const env = vi.hoisted(() => ({
  GOVERNANCE_ADMIN_PUBLIC_KEYS: "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA",
  DATABASE_URL: "postgres://neondb_owner:db-secret-pw@ep-cool-1.eu-central-1.aws.neon.tech/neondb",
  DATABASE_URL_UNPOOLED:
    "postgres://neondb_owner:db-secret-pw@ep-cool-1.eu-central-1.aws.neon.tech/x",
  NEXT_PUBLIC_APP_URL: "https://gov.example",
  TELEGRAM_BOT_TOKEN: "7700112233:tg-secret-token-AAE",
  TELEGRAM_CHAT_ID: "-1009990001",
  ANTHROPIC_API_KEY: "sk-ant-api03-secret-key",
  KV_REST_API_TOKEN: "kv-secret-token",
  R2_ACCOUNT_ID: "r2-account-secret",
  R2_ACCESS_KEY_ID: "r2-access-key-id-secret",
  R2_SECRET_ACCESS_KEY: "r2-secret-access-key",
  R2_ENDPOINT: "https://r2-account-secret.r2.cloudflarestorage.com",
  R2_PUBLIC_URL: "https://pub-secret.r2.dev",
  R2_BUCKET: "enjin-governance",
  SITE_PASSWORD: "gate-secret-pw",
  LEGAL_OPERATOR_ADDRESS: "Secret Street 1 | 12345 Hidden City",
}))
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; address: string; handle: string | null },
}))
const infra = vi.hoisted(() => ({ r2: true, dbDown: false }))
const signed = vi.hoisted(() => [] as { bucket: string; key: string; expiresIn: number }[])

vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => auth.user }))
vi.mock("@/lib/db/client", async () => {
  const { dbClientMock } = await import("@/test/pglite")
  return {
    isDbConfigured: () => true,
    getSql: () => {
      if (infra.dbDown) throw new Error(`connect ECONNREFUSED ${env.DATABASE_URL}`)
      return dbClientMock.getSql()
    },
  }
})
vi.mock("@/lib/r2/client", async () => {
  const r2 = await import("./fake-r2")
  return {
    isR2Configured: () => infra.r2,
    getR2Client: () => r2.client,
    r2Bucket: () => env.R2_BUCKET,
  }
})
// Signs like the real presigner: the access key id (never the secret) and a signature.
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (
    _client: unknown,
    cmd: { input: { Bucket: string; Key: string } },
    opts: { expiresIn: number },
  ) => {
    signed.push({ bucket: cmd.input.Bucket, key: cmd.input.Key, expiresIn: opts.expiresIn })
    const credential = encodeURIComponent(`${env.R2_ACCESS_KEY_ID}/20260926/auto/s3/aws4_request`)
    return `https://${env.R2_BUCKET}.r2.example/${cmd.input.Key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${credential}&X-Amz-Expires=${opts.expiresIn}&X-Amz-Signature=${"5".repeat(64)}`
  },
}))

import * as r2 from "./fake-r2"
import packageJson from "@/package.json"
import { publicKeyOf } from "@/lib/chain/ss58"
import { resetSlots } from "@/lib/moderation/slots"
import { saveSetting } from "@/lib/db/moderation"
import { DELETE as REMOVE, GET as LIST, POST as CREATE } from "@/app/api/moderation/backup/route"
import { GET as DOWNLOAD } from "@/app/api/moderation/backup/download/route"
import { GET as READ } from "@/app/r/[...key]/route"

const db = setupTestDb()

/** Every value that must never reach a response or the archive. */
const SECRETS = [
  DATABASE_URL,
  "db-secret-pw",
  "neondb_owner",
  "7700112233",
  "tg-secret-token",
  "-1009990001",
  "sk-ant-api03-secret-key",
  "kv-secret-token",
  "r2-account-secret",
  "r2-access-key-id-secret",
  "r2-secret-access-key",
  "pub-secret.r2.dev",
  "gate-secret-pw",
  "Secret Street",
  // Sign-in secrets from the tables a backup leaves out.
  "session-token-hash",
  "nonce-secret",
]
function expectNoSecrets(raw: string, allow: string[] = []) {
  for (const s of SECRETS) if (!allow.includes(s)) expect(raw).not.toContain(s)
  expect(raw).not.toMatch(/postgres(ql)?:\/\//i)
}

const NET = "enjin-relay"
const PID = "22222222-2222-4222-8222-222222222222"
const FOLDER = `proposals/${NET}/${PID}`
const JSON_KEYS = [
  `${FOLDER}/proposal-0123456789abcdef.json`,
  `${FOLDER}/proposal-fedcba9876543210.json`,
  `proposals/canary-relay/33333333-3333-4333-8333-333333333333/proposal.json`,
  `proposals/${NET}/index/42.json`,
]
const MEDIA = `${FOLDER}/media/ab12cd34-roadmap.png`
const THUMB = `${MEDIA}.thumb.webp`
const PDF = `${FOLDER}/media/ef56ab78-budget.pdf`
const AVATAR = "user-avatars/44444444-4444-4444-8444-444444444444.png"
const UNSAFE = `proposals/${NET}/../escape.json`
const OUTSIDE = ["other/notes.txt", "backups/manual-copy.zip"]
/** Incompressible, and larger than one upload part. */
const BIG = randomBytes(9 * 1024 * 1024)

const signIn = (who: string | null) => {
  auth.user = who ? { id: `user-${who.slice(0, 6)}`, address: who, handle: null } : null
}
const backupKey = (iso: string, n: number) =>
  `backups/${iso}-${n.toString(16).padStart(32, "0")}.zip`
const request = (method: string, path: string, body?: unknown) =>
  new NextRequest(`https://gov.test${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: typeof body === "string" ? body : JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
  })

async function create(body: unknown = { include_media: false }) {
  const res = await CREATE(request("POST", "/api/moderation/backup", body))
  const raw = await res.text()
  return {
    res,
    raw,
    body: JSON.parse(raw) as {
      ok: boolean
      error?: string
      backup?: { key: string; size: number; created: string }
    },
  }
}
async function list() {
  const res = await LIST()
  const raw = await res.text()
  return {
    res,
    raw,
    body: JSON.parse(raw) as {
      ok: boolean
      error?: string
      items: { key: string; size: number; created: string }[]
      running: { phase: string; done: number; total: number } | null
      keep: number
    },
  }
}
const remove = (body: unknown) => REMOVE(request("DELETE", "/api/moderation/backup", body))
const download = (key: string) =>
  DOWNLOAD(request("GET", `/api/moderation/backup/download?key=${encodeURIComponent(key)}`))

type Archive = { files: Record<string, Uint8Array>; bytes: Buffer }
function archive(key: string): Archive {
  const bytes = r2.objects.get(key)!.bytes
  return { bytes, files: unzipSync(new Uint8Array(bytes)) }
}
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")

/** Compression method of every entry, from the ZIP's central directory (0 stored, 8 deflate). */
function methods(zip: Buffer): Record<string, number> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = zip.readUInt16LE(eocd + 10)
  let at = zip.readUInt32LE(eocd + 16)
  const out: Record<string, number> = {}
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const nameLength = zip.readUInt16LE(at + 28)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8")
    out[name] = zip.readUInt16LE(at + 10)
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
  }
  return out
}

const storedBackups = () => [...r2.objects.keys()].filter((k) => /^backups\/.+Z-/.test(k)).sort()
const commandsFor = (name: string) => r2.calls.filter((c) => c.command === name)

/**
 * Moves Date.now() forward, for "the backup ran too long". Only ever
 * forward: the test database's client waits for the clock to pass the
 * time of its last statement. A plain function, not a spy, which would
 * record every one of those reads.
 */
let clockOffset = 0
const realNow = Date.now
beforeAll(async () => {
  Date.now = () => realNow() + clockOffset
  const { initializeWasm } = await import("@/lib/chain/ss58")
  await initializeWasm()
})
afterAll(() => {
  Date.now = realNow
})

beforeEach(async () => {
  r2.resetR2()
  resetSlots()
  signed.length = 0
  infra.r2 = true
  infra.dbDown = false
  signIn(null)
  // Failures are logged on the server (tested below); keep the output quiet.
  vi.spyOn(console, "error").mockImplementation(() => undefined)

  const sql = db.sql
  await sql`
    INSERT INTO moderation_roles (public_key, role) VALUES (${`0x${publicKeyOf(MOD)}`}, 'moderator')`
  const [u] = await sql`
    INSERT INTO users (address, handle, bio) VALUES (${address(5)}, 'carol', 'Hello') RETURNING id`
  await sql`
    INSERT INTO wallet_sessions (token_hash, user_id, address, expires_at)
    VALUES ('session-token-hash', ${u!.id}, ${address(5)}, NOW() + INTERVAL '1 day')`
  await sql`
    INSERT INTO auth_nonces (nonce, address, message, expires_at)
    VALUES ('nonce-secret', ${address(5)}, 'Sign in', NOW() + INTERVAL '5 minutes')`
  await sql`
    INSERT INTO proposals (id, network, referendum_index, proposer_address, title, amount_planck,
                           json_url, json_key, json_sha256, block_number, status)
    VALUES (${PID}, ${NET}, 42, ${address(5)}, 'Roadmap', '99999999999999999999999999',
            ${`https://gov.example/r/${JSON_KEYS[0]}`}, ${JSON_KEYS[0]}, ${"a".repeat(64)},
            '9007199254740993', 'on_chain')`
  await sql`
    INSERT INTO security_disclosures (severity, summary, details, contact)
    VALUES ('high', 'XSS', 'Details', 'researcher@example.org')`

  for (const [i, key] of JSON_KEYS.entries()) {
    r2.putObject(key, JSON.stringify({ v: i, title: "Roadmap", pad: "x".repeat(2000) }), {
      contentType: "application/json",
    })
  }
  r2.putObject(MEDIA, BIG, { contentType: "image/png" })
  r2.putObject(THUMB, randomBytes(5000), { contentType: "image/webp" })
  r2.putObject(PDF, randomBytes(3000), { contentType: "application/pdf" })
  r2.putObject(AVATAR, randomBytes(2000), { contentType: "image/png" })
  r2.putObject(UNSAFE, "{}", { contentType: "application/json" })
  for (const key of OUTSIDE) r2.putObject(key, "not part of a backup")
  // Small pages, so every listing takes several requests.
  r2.options.pageSize = 3
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("who may", () => {
  it("is admins only: nobody else lists, creates, downloads or deletes, and nothing is touched", async () => {
    const key = backupKey("2026-09-01T00:00:00Z", 1)
    r2.putObject(key, "zip")
    for (const who of [null, USER, MOD]) {
      signIn(who)
      const status = who ? 403 : 401
      expect((await LIST()).status).toBe(status)
      expect((await CREATE(request("POST", "/api/moderation/backup", {}))).status).toBe(status)
      expect((await download(key)).status).toBe(status)
      expect((await remove({ key })).status).toBe(status)
    }
    expect(r2.calls).toEqual([])
    expect(signed).toEqual([])
    expect(r2.objects.has(key)).toBe(true)
    // No slot used up by a refused attempt.
    expect(await db.sql`SELECT key FROM moderation_settings`).toEqual([])
  })

  it("answers 503 in words when storage isn't configured", async () => {
    signIn(ADMIN)
    infra.r2 = false
    for (const res of [
      await LIST(),
      await CREATE(request("POST", "/api/moderation/backup", {})),
      await download(backupKey("2026-09-01T00:00:00Z", 1)),
      await remove({ key: backupKey("2026-09-01T00:00:00Z", 1) }),
    ]) {
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({
        ok: false,
        error: "Storage isn't configured. Backups are kept in R2.",
      })
    }
    expect(r2.calls).toEqual([])
  })
})

describe("creating a backup", () => {
  it("stores one ZIP under backups/ with the database and every proposal JSON, but no uploads", async () => {
    signIn(ADMIN)
    const { res, raw, body } = await create()
    expect(res.status).toBe(200)
    expectNoSecrets(raw)
    const { key, size, created } = body.backup!
    expect(key).toMatch(/^backups\/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z-[0-9a-f]{32}\.zip$/)
    expect(created).toBe(`${key.slice(8, 27)}.000Z`)
    const stored = r2.objects.get(key)!
    expect(size).toBe(stored.bytes.byteLength)
    expect(stored.contentType).toBe("application/zip")
    expect(stored.contentDisposition).toBe(
      `attachment; filename="enjin-governance-backup-${key.slice(8, 27).replace(/:/g, "-")}Z.zip"`,
    )
    // Written with a multipart upload, and nothing left open.
    expect(commandsFor("CreateMultipartUpload").map((c) => c.key)).toEqual([key])
    expect(r2.uploads.size).toBe(0)

    const { files, bytes } = archive(key)
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!))
    expect(manifest).toMatchObject({
      format: "enjin-governance-backup",
      format_version: 1,
      app_version: packageJson.version,
      created_at: created,
      created_by: `0x${publicKeyOf(ADMIN)}`,
      include_media: false,
      migrations: db.migrations.map((filename) => ({ filename, applied_at: expect.any(String) })),
    })
    expect(manifest.database.excluded_tables).toEqual([
      { name: "auth_nonces", reason: expect.stringContaining("Short-lived secrets") },
      { name: "wallet_sessions", reason: expect.stringContaining("Short-lived secrets") },
    ])

    // Every application table but the excluded ones and the ledger.
    const tables = (
      await db.sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`
    ).map((r) => r.tablename as string)
    const backedUp = tables.filter(
      (t) => !["_migrations", "auth_nonces", "wallet_sessions"].includes(t),
    )
    expect(backedUp.length).toBeGreaterThan(10)
    expect(
      Object.keys(files)
        .filter((p) => p.startsWith("db/") && p.endsWith(".json"))
        .sort(),
    ).toEqual(backedUp.map((t) => `db/${t}.json`).sort())
    expect(files["db/auth_nonces.json"]).toBeUndefined()
    expect(files["db/wallet_sessions.json"]).toBeUndefined()
    const proposals = JSON.parse(strFromU8(files["db/proposals.json"]!))
    expect(proposals).toEqual([
      expect.objectContaining({
        id: PID,
        amount_planck: "99999999999999999999999999",
        block_number: "9007199254740993",
      }),
    ])
    expect(strFromU8(files["db/restore.sql"]!)).toContain(
      'INSERT INTO "proposals" ("id", "network", "referendum_index"',
    )
    expect(strFromU8(files["README.txt"]!)).toContain("THIS ARCHIVE CONTAINS PERSONAL DATA")

    // Proposal JSON always; uploaded files, thumbnails and avatars only when asked.
    const bucketFiles = Object.keys(files)
      .filter((p) => p.startsWith("bucket/"))
      .sort()
    expect(bucketFiles).toEqual(JSON_KEYS.map((k) => `bucket/${k}`).sort())
    for (const k of JSON_KEYS) {
      expect(Buffer.from(files[`bucket/${k}`]!)).toEqual(r2.objects.get(k)!.bytes)
    }
    expect(manifest.bucket).toEqual({
      objects: JSON_KEYS.length,
      uploaded_files_included: false,
      skipped: [{ key: UNSAFE, reason: "The key can't be a file name in a ZIP." }],
    })
    expect(
      r2.calls.filter((c) => c.command === "ListObjectsV2").map((c) => c.prefix),
    ).not.toContain("user-avatars/")
    expect(
      commandsFor("GetObject")
        .map((c) => c.key)
        .sort(),
    ).toEqual([...JSON_KEYS].sort())

    // The manifest names every other file, with its size and sha256.
    const listed = manifest.files as { path: string; size: number; sha256: string }[]
    expect(listed.map((f) => f.path).sort()).toEqual(
      Object.keys(files)
        .filter((p) => p !== "manifest.json")
        .sort(),
    )
    for (const f of listed) {
      expect(f.size, f.path).toBe(files[f.path]!.byteLength)
      expect(f.sha256, f.path).toBe(sha256(files[f.path]!))
    }
    // Text is deflated.
    for (const [name, method] of Object.entries(methods(bytes))) expect(method, name).toBe(8)

    expectNoSecrets(
      Object.values(files)
        .map((f) => strFromU8(f))
        .join("\n"),
    )
  })

  it("includes uploaded files, thumbnails and avatars when asked, stored byte for byte", async () => {
    signIn(ADMIN)
    const { res, body } = await create({ include_media: true })
    expect(res.status).toBe(200)
    const { key } = body.backup!
    const { files, bytes } = archive(key)
    for (const k of [...JSON_KEYS, MEDIA, THUMB, PDF, AVATAR]) {
      expect(Buffer.from(files[`bucket/${k}`]!).equals(r2.objects.get(k)!.bytes), k).toBe(true)
    }
    expect(Object.keys(files).filter((p) => p.startsWith("bucket/"))).toHaveLength(8)
    expect(files[`bucket/${UNSAFE}`]).toBeUndefined()
    for (const k of OUTSIDE) expect(files[`bucket/${k}`]).toBeUndefined()

    const manifest = JSON.parse(strFromU8(files["manifest.json"]!))
    expect(manifest.include_media).toBe(true)
    const entry = (manifest.files as { path: string; sha256: string; size: number }[]).find(
      (f) => f.path === `bucket/${MEDIA}`,
    )
    expect(entry).toEqual({ path: `bucket/${MEDIA}`, size: BIG.byteLength, sha256: sha256(BIG) })

    // Media is already compressed: stored. JSON and the database are deflated.
    const method = methods(bytes)
    for (const k of [MEDIA, THUMB, PDF, AVATAR]) expect(method[`bucket/${k}`], k).toBe(0)
    for (const k of JSON_KEYS) expect(method[`bucket/${k}`], k).toBe(8)
    expect(method["db/users.json"]).toBe(8)

    // More than one part: every part but the last exactly 8 MiB.
    const parts = r2.completedParts.get(key)!
    expect(parts.length).toBe(2)
    expect(parts[0]).toBe(8 * 1024 * 1024)
    expect(parts[0]! + parts[1]!).toBe(bytes.byteLength)
  })

  it("happens at most once every 10 minutes, across servers", async () => {
    signIn(ADMIN)
    expect((await create()).res.status).toBe(200)

    const again = await create()
    expect(again.res.status).toBe(429)
    expect(again.res.headers.get("Retry-After")).toBe("600")
    expect(again.body.error).toBe(
      "One backup every 10 minutes: the last one was started less than 10 minutes ago. Try again later.",
    )
    // Another server: nothing in memory, but the database remembers.
    resetSlots()
    expect((await create({ include_media: true })).res.status).toBe(429)
    expect(storedBackups()).toHaveLength(1)

    // Ten minutes on.
    await db.sql`
      UPDATE moderation_settings SET updated_at = NOW() - INTERVAL '10 minutes 1 second'
       WHERE key = 'slot:backup'`
    resetSlots()
    expect((await create()).res.status).toBe(200)
    expect(storedBackups()).toHaveLength(2)
  })

  it("keeps the newest 5, and never touches anything else under backups/", async () => {
    signIn(ADMIN)
    const old = [1, 2, 3, 4, 5].map((n) => backupKey(`2026-0${n}-01T00:00:00Z`, n))
    for (const k of old) r2.putObject(k, "old backup")
    expect((await create()).res.status).toBe(200)
    const kept = storedBackups()
    expect(kept).toHaveLength(5)
    expect(kept).not.toContain(old[0])
    expect(kept).toEqual(expect.arrayContaining(old.slice(1)))
    expect(r2.objects.has("backups/manual-copy.zip")).toBe(true)
    expect(commandsFor("DeleteObject").map((c) => c.key)).toEqual([old[0]])
  })

  it("refuses a body it doesn't understand", async () => {
    signIn(ADMIN)
    for (const body of ["{not json", { include_media: "yes" }, { include_media: true, extra: 1 }]) {
      const { res, body: out } = await create(body)
      expect(res.status).toBe(400)
      expect(out.error).toBe("Say whether to include uploaded files.")
    }
    expect(r2.calls).toEqual([])
  })

  it("stops before writing when the files can't fit in one ZIP", async () => {
    signIn(ADMIN)
    r2.putObject(`${FOLDER}/media/huge.mp4`, "x", { listedSize: 5 * 1024 ** 3 })
    const { res, raw, body } = await create({ include_media: true })
    expect(res.status).toBe(413)
    expect(body.error).toBe(
      "The backup would be larger than 4 GB, the most one ZIP file can hold. Create it without uploaded files.",
    )
    expectNoSecrets(raw)
    expect(commandsFor("CreateMultipartUpload")).toEqual([])
    // Without the uploads it fits (another slot, ten minutes on).
    await db.sql`UPDATE moderation_settings SET updated_at = NOW() - INTERVAL '11 minutes'`
    resetSlots()
    expect((await create({ include_media: false })).res.status).toBe(200)
  })

  it("drops a backup that runs too long, and says so in words", async () => {
    signIn(ADMIN)
    r2.hooks.onGet = (key) => {
      if (key === MEDIA) clockOffset += 300_000
    }
    const { res, raw, body } = await create({ include_media: true })
    expect(res.status).toBe(504)
    expect(body.error).toBe(
      "The backup took too long and was stopped. Nothing was saved. Create it without uploaded files, or try again later.",
    )
    expectNoSecrets(raw)
    expect(commandsFor("AbortMultipartUpload")).toHaveLength(1)
    expect(r2.uploads.size).toBe(0)
    expect(storedBackups()).toEqual([])
  })

  it("leaves nothing behind when storage fails mid-way, and shows no raw error", async () => {
    signIn(ADMIN)
    r2.faults.GetObject = new Error(
      `connect ECONNREFUSED ${env.R2_ENDPOINT} ${env.R2_SECRET_ACCESS_KEY}`,
    )
    const { res, raw, body } = await create()
    expect(res.status).toBe(502)
    expect(body).toEqual({
      ok: false,
      error: "Storage couldn't be read or written. Nothing was saved. Try again later.",
    })
    expectNoSecrets(raw)
    expect(commandsFor("AbortMultipartUpload")).toHaveLength(1)
    expect(storedBackups()).toEqual([])
    // The cause goes to the server log only.
    expect(console.error).toHaveBeenCalledWith(
      "[moderation/backup] failed (storage)",
      expect.stringContaining("ECONNREFUSED"),
    )
  })

  it("says so in words when the database can't be read", async () => {
    signIn(ADMIN)
    infra.dbDown = true
    const { res, raw, body } = await create()
    expect(res.status).toBe(502)
    expect(body.error).toBe("The database couldn't be read. Nothing was saved. Try again later.")
    expectNoSecrets(raw)
    expect(storedBackups()).toEqual([])
    expect(r2.uploads.size).toBe(0)
  })
})

describe("listing, downloading and deleting", () => {
  const A = backupKey("2026-09-01T08:00:00Z", 0xa)
  const B = backupKey("2026-09-20T08:00:00Z", 0xb)

  beforeEach(() => {
    r2.putObject(A, "a".repeat(10))
    r2.putObject(B, "b".repeat(20))
  })

  it("lists only real backups, newest first, with sizes and dates", async () => {
    signIn(ADMIN)
    const { res, raw, body } = await list()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(body).toEqual({
      ok: true,
      items: [
        { key: B, size: 20, created: "2026-09-20T08:00:00.000Z" },
        { key: A, size: 10, created: "2026-09-01T08:00:00.000Z" },
      ],
      running: null,
      keep: 5,
    })
    expectNoSecrets(raw)
  })

  it("shows a backup while it runs, and forgets one that can't still be running", async () => {
    signIn(ADMIN)
    const progress = {
      phase: "files",
      done: 3,
      total: 10,
      bytes: 12345,
      include_media: true,
      started_at: new Date(Date.now() - 30_000).toISOString(),
    }
    await saveSetting("backup_progress", progress, "0xadmin")
    expect((await list()).body.running).toEqual(progress)
    await saveSetting(
      "backup_progress",
      { ...progress, started_at: new Date(Date.now() - 15 * 60_000).toISOString() },
      "0xadmin",
    )
    expect((await list()).body.running).toBeNull()
    await saveSetting("backup_progress", { ...progress, phase: "done" }, "0xadmin")
    expect((await list()).body.running).toBeNull()
  })

  it("downloads through a redirect to a link signed for a few minutes", async () => {
    signIn(ADMIN)
    const res = await download(A)
    expect(res.status).toBe(303)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(signed).toEqual([{ bucket: "enjin-governance", key: A, expiresIn: 300 }])
    const location = new URL(res.headers.get("Location")!)
    expect(location.pathname).toBe(`/${A}`)
    expect(location.searchParams.get("X-Amz-Expires")).toBe("300")
    // A signed link names the access key id, as every S3 link does; never the secret.
    expectNoSecrets(res.headers.get("Location")!, ["r2-access-key-id-secret"])
    expect(await res.text()).toBe("")
  })

  it("accepts only backup keys: no other file, no traversal, nothing outside backups/", async () => {
    signIn(ADMIN)
    const bad = [
      "",
      "backups/",
      "backups/manual-copy.zip",
      `${A}/../../${JSON_KEYS[0]}`,
      `backups/../${JSON_KEYS[0]}`,
      JSON_KEYS[0]!,
      AVATAR,
      `/${A}`,
      `${A}\n`,
      `${A}?x=1`,
      A.replace("backups/", "BACKUPS/"),
      A.replace("backups/", "backups\\"),
      A.replace(".zip", ".json"),
      `other/${A}`,
    ]
    for (const key of bad) {
      const res = await download(key)
      expect(res.status, key).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: "That isn't a backup." })
      const del = await remove({ key })
      expect(del.status, key).toBe(400)
    }
    for (const body of [{}, { key: 1 }, { key: A, extra: true }, "nope"]) {
      expect((await remove(body)).status).toBe(400)
    }
    expect(r2.calls).toEqual([])
    expect(signed).toEqual([])
  })

  it("says when a backup is gone, without signing anything", async () => {
    signIn(ADMIN)
    const gone = backupKey("2026-01-01T00:00:00Z", 0xc)
    const res = await download(gone)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: "That backup doesn't exist anymore." })
    expect((await remove({ key: gone })).status).toBe(404)
    expect(signed).toEqual([])
    expect(commandsFor("DeleteObject")).toEqual([])
  })

  it("deletes exactly the backup named", async () => {
    signIn(ADMIN)
    const res = await remove({ key: A })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(commandsFor("DeleteObject").map((c) => c.key)).toEqual([A])
    expect(r2.objects.has(A)).toBe(false)
    expect(r2.objects.has(B)).toBe(true)
    expect((await list()).body.items.map((i) => i.key)).toEqual([B])
  })

  it("answers in words when storage can't be reached", async () => {
    signIn(ADMIN)
    r2.faults.ListObjectsV2 = new Error(`timeout ${env.R2_ENDPOINT}`)
    r2.faults.HeadObject = new Error(`timeout ${env.R2_SECRET_ACCESS_KEY}`)
    for (const res of [await LIST(), await download(A), await remove({ key: A })]) {
      expect(res.status).toBe(502)
      const raw = await res.text()
      expect(JSON.parse(raw)).toEqual({
        ok: false,
        error: "Storage couldn't be reached. Try again later.",
      })
      expectNoSecrets(raw)
    }
  })

  it("is never served by the public /r route", async () => {
    for (const key of [A, "backups/manual-copy.zip"]) {
      const res = await READ(new NextRequest(`https://gov.test/r/${key}`), {
        params: Promise.resolve({ key: key.split("/") }),
      })
      expect(res.status, key).toBe(404)
    }
    // Not even a read attempt.
    expect(r2.calls).toEqual([])
  })
})

/**
 * POST /api/proposals/[uuid]/media: who may upload (session, posting
 * pause, the proposer once a draft exists, rate limit), what may be
 * uploaded (4 MB, listed types judged by the bytes, readable images), what
 * is stored (cleaned image + thumbnail, a sanitised key inside the
 * proposal's media folder, the stored file's own details in the answer)
 * and the automatic check (a clear violation is never stored, a borderline
 * file is held before it is stored, an outage never blocks). Real route
 * handlers and real image processing (sharp); only I/O (session, DB,
 * bucket, rate-limit store, Anthropic, Telegram) is mocked.
 */
import { createHash } from "node:crypto"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import sharp from "sharp"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import type * as RateLimit from "@/lib/rate-limit"

const ALICE = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const BOB = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const MOD = "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH"

vi.hoisted(() => {
  // Set so checks can run; the SDK itself is replaced below.
  process.env.ANTHROPIC_API_KEY = "test-key"
  process.env.GOVERNANCE_ADMIN_PUBLIC_KEYS = ""
})
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; address: string; handle: string | null },
}))
const ai = vi.hoisted(() => ({
  next: null as unknown,
  fail: false,
  images: [] as { fileName?: string }[],
  pdfs: [] as { bytes: Buffer; fileName?: string }[],
}))
const notices = vi.hoisted(() => [] as unknown[])
const rate = vi.hoisted(() => ({ store: new Map<string, { count: number; resetAt: number }>() }))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() {
      throw new Error("no Anthropic API in tests")
    }
  },
}))
vi.mock("@/lib/moderation/scan", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  scanImage: async (_jpeg: Buffer, opts: { fileName?: string }) => {
    ai.images.push({ fileName: opts.fileName })
    if (ai.fail) throw new Error("socket hang up")
    return ai.next
  },
  scanPdf: async (bytes: Buffer, opts: { fileName?: string }) => {
    ai.pdfs.push({ bytes, fileName: opts.fileName })
    if (ai.fail) throw new Error("socket hang up")
    return ai.next
  },
}))
vi.mock("@/lib/moderation/notify", () => ({
  notifyNewReport: async (n: unknown) => void notices.push(n),
}))
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => auth.user }))
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/r2/client", () => ({
  isR2Configured: () => true,
  r2Bucket: () => "enjin-governance",
  publicAssetBase: () => "https://fake.local/r",
  r2PublicBase: () => "https://pub.r2.dev",
  getR2Client: () => ({
    send: async (cmd: { input: { Key: string } }) => {
      const e = bucketMod.bucket.get(cmd.input.Key)
      if (!e) throw Object.assign(new Error("missing"), { name: "NoSuchKey" })
      return {
        Body: { transformToByteArray: async () => new Uint8Array(bucketMod.bytesOf(e)) },
        ContentType: e.contentType,
      }
    },
  }),
}))
vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof RateLimit>()
  return {
    ...real,
    // The real fixed-window counter over a per-test store: no KV, no network.
    enforceRateLimit: async (a: {
      scope: string
      identity: string
      limit: number
      windowMs: number
    }) => real.consume(rate.store, `${a.scope}:${a.identity}`, a.limit, a.windowMs, Date.now()),
  }
})
vi.mock("@/lib/db/moderation", async () => await import("./fake-moderation"))
vi.mock("@/lib/db/proposals", async () => await import("./fake-db"))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))

import * as bucketMod from "./fake-bucket"
import * as db from "./fake-db"
import * as mod from "./fake-moderation"
import { publicKeyOf } from "@/lib/chain/ss58"
import { checkAttachments, cleanAttachmentName } from "@/lib/governance/attachment-check"
import { DEFAULT_SCAN_SETTINGS, type ScanSettings } from "@/lib/moderation/scan-settings"
import { resetScanSettingsCache } from "@/lib/moderation/settings-store"
import { ownMediaKey } from "@/lib/r2/paths"
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/limits"
import { POST } from "@/app/api/proposals/[uuid]/media/route"
import { GET as MEDIA } from "@/app/api/moderation/media/route"
import { GET as LOG } from "@/app/api/moderation/log/route"
import { GET as READ } from "@/app/r/[...key]/route"

const NET = "enjin-relay"
const PID = "22222222-2222-4222-8222-222222222222"
const HELD_REASON = "Held for a moderator by the automatic check."

const asMatrix = (address: string) => encodeAddress(decodeAddress(address), 1110)
const pk = (address: string) => `0x${publicKeyOf(address)}`
const signIn = (address: string) => {
  auth.user = { id: `user-${address.slice(0, 6)}`, address, handle: null }
}
const scanWith = (over: Partial<ScanSettings>) => {
  mod.settings.set("content_scan", { ...DEFAULT_SCAN_SETTINGS, enabled: true, ...over })
  resetScanSettingsCache()
}

const picture = (width = 48, height = 32) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
const png = () => picture().png().toBuffer()
const pdf = (pages = 1) =>
  Buffer.from(`%PDF-1.4\n${"<< /Type /Page >>\n".repeat(pages)}<< /Type /Pages >>\n%%EOF\n`)

type Answer = {
  ok: boolean
  error?: string
  moderation: "blurred" | null
  bucket_key: string
  url: string
  sha256: string
  size_bytes: number
  content_type: string
  name: string
  precomputed_sha256_matches: boolean
}
function upload(
  id: string,
  file: { bytes: Buffer; name?: string; type?: string } | null,
  network: string | null = NET,
) {
  const form = new FormData()
  if (file) {
    form.append(
      "file",
      new File([new Uint8Array(file.bytes)], file.name ?? "chart.png", {
        type: file.type ?? "image/png",
      }),
    )
  }
  const query = network ? `?network=${network}` : ""
  return POST(
    new NextRequest(`https://gov.test/api/proposals/${id}/media${query}`, {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ uuid: id }) },
  )
}
const answer = async (res: Response) => (await res.json()) as Answer
/** Everything stored in a proposal's folder. */
const stored = (id = PID) =>
  [...bucketMod.bucket.keys()].filter((k) => k.startsWith(`proposals/${NET}/${id}/`))
const read = (key: string) =>
  READ(new NextRequest(`https://gov.test/r/${key}`), {
    params: Promise.resolve({ key: key.split("/") }),
  })
const verdict = (decision: "allow" | "review" | "block") => ({
  kind: "verdict",
  verdict: {
    decision,
    severity: "high",
    labels: ["id_document"],
    explanation: "Passport photo of Jane Doe with her passport number.",
  },
  usage: { inputTokens: 1900, outputTokens: 80 },
})

beforeEach(() => {
  db.reset()
  bucketMod.resetBucket()
  mod.resetModeration()
  rate.store.clear()
  notices.length = 0
  ai.next = verdict("allow")
  ai.fail = false
  ai.images.length = 0
  ai.pdfs.length = 0
  scanWith({})
  mod.roles.set(pk(MOD), { role: "moderator", granted_by: null, created_at: new Date(0) })
  signIn(ALICE)
})

describe("who may upload", () => {
  it("needs a session, and refuses paused accounts, storing nothing", async () => {
    auth.user = null
    expect((await upload(PID, { bytes: await png() })).status).toBe(401)
    mod.suspensions.set(pk(ALICE), new Date(Date.now() + 86_400_000))
    signIn(asMatrix(ALICE))
    const res = await upload(PID, { bytes: await png() })
    expect(res.status).toBe(403)
    expect((await answer(res)).error).toMatch(/paused/)
    expect(bucketMod.putCalls).toEqual([])
    expect(ai.images).toEqual([])
  })

  it("refuses files for someone else's draft; its proposer may upload in any address format", async () => {
    db.seedProposal({
      id: PID,
      network: NET,
      proposer_address: ALICE,
      json_key: `proposals/${NET}/${PID}/proposal.json`,
    })
    signIn(BOB)
    expect((await upload(PID, { bytes: await png() })).status).toBe(403)
    expect(stored()).toEqual([])
    signIn(asMatrix(ALICE))
    const res = await upload(PID, { bytes: await png() })
    expect(res.status).toBe(200)
    expect((await answer(res)).bucket_key).toMatch(new RegExp(`^proposals/${NET}/${PID}/media/`))
  })

  it("accepts uploads before the draft exists, always into a lower-case folder", async () => {
    const upper = "ABCDEF12-3456-4789-8ABC-DEF123456789"
    const res = await upload(upper, { bytes: await png() })
    expect(res.status).toBe(200)
    expect(
      (await answer(res)).bucket_key.startsWith(`proposals/${NET}/${upper.toLowerCase()}/`),
    ).toBe(true)
    expect((await upload("not-a-uuid", { bytes: await png() })).status).toBe(400)
    expect((await upload(PID, { bytes: await png() }, null)).status).toBe(400)
    expect((await upload(PID, { bytes: await png() }, "polkadot")).status).toBe(400)
    expect(stored()).toEqual([])
  })

  it("is rate-limited per account: 30 uploads in five minutes, then 429", async () => {
    scanWith({ enabled: false })
    for (let i = 0; i < 30; i += 1) {
      const res = await upload(PID, { bytes: pdf(), name: `doc-${i}.pdf`, type: "application/pdf" })
      expect(res.status).toBe(200)
    }
    const res = await upload(PID, { bytes: pdf(), name: "one-more.pdf", type: "application/pdf" })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(stored()).toHaveLength(30)
    signIn(BOB)
    expect((await upload(PID, { bytes: pdf(), type: "application/pdf" })).status).toBe(200)
  })
})

describe("what may be uploaded", () => {
  it("caps a file at 4 MB", async () => {
    scanWith({ enabled: false })
    const big = Buffer.concat([pdf(), Buffer.alloc(MAX_UPLOAD_BYTES + 1 - pdf().length, 0x20)])
    expect(big.length).toBe(MAX_UPLOAD_BYTES + 1)
    const res = await upload(PID, { bytes: big, name: "big.pdf", type: "application/pdf" })
    expect(res.status).toBe(413)
    expect((await answer(res)).error).toContain("4 MB")
    expect(stored()).toEqual([])
    const fits = big.subarray(0, MAX_UPLOAD_BYTES)
    const ok = await upload(PID, { bytes: fits, name: "fits.pdf", type: "application/pdf" })
    expect(ok.status).toBe(200)
    expect((await answer(ok)).size_bytes).toBe(MAX_UPLOAD_BYTES)
  })

  it("refuses empty files, a missing file part, over-long names and non-multipart bodies", async () => {
    expect((await upload(PID, { bytes: Buffer.alloc(0) })).status).toBe(400)
    expect((await upload(PID, null)).status).toBe(400)
    expect((await upload(PID, { bytes: await png(), name: `${"a".repeat(252)}.png` })).status).toBe(
      400,
    )
    const notMultipart = await POST(
      new NextRequest(`https://gov.test/api/proposals/${PID}/media?network=${NET}`, {
        method: "POST",
        body: JSON.stringify({ file: "x" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ uuid: PID }) },
    )
    expect(notMultipart.status).toBe(400)
    expect(stored()).toEqual([])
  })

  it("only takes the listed types", async () => {
    for (const type of ["image/svg+xml", "text/html", "application/octet-stream", ""]) {
      expect((await upload(PID, { bytes: await png(), type })).status).toBe(415)
    }
    expect(stored()).toEqual([])
  })

  it("judges a file by its bytes, never by the type it claims", async () => {
    const disguised = [
      "<html><script>alert(document.cookie)</script></html>",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "MZ\x90\x00 an executable, renamed",
    ]
    for (const body of disguised) {
      const res = await upload(PID, { bytes: Buffer.from(body), name: "cat.png" })
      expect(res.status).toBe(415)
    }
    // Right magic bytes, but not a readable image.
    const broken = Buffer.concat([(await png()).subarray(0, 16), Buffer.alloc(64, 0x41)])
    expect((await upload(PID, { bytes: broken })).status).toBe(415)
    expect(stored()).toEqual([])

    // A real file under another listed type is stored as what it really is.
    const asPng = await answer(
      await upload(PID, { bytes: pdf(), name: "a.png", type: "image/png" }),
    )
    expect(asPng.content_type).toBe("application/pdf")
    expect(bucketMod.bucket.get(asPng.bucket_key)?.contentType).toBe("application/pdf")
    const asJpeg = await answer(await upload(PID, { bytes: await png(), type: "image/jpeg" }))
    expect(asJpeg.content_type).toBe("image/png")
    expect(bucketMod.bucket.get(asJpeg.bucket_key)?.contentType).toBe("image/png")
  })

  it("stores the cleaned image and a thumbnail, and answers with the stored file's own details", async () => {
    const photo = await picture(300, 200)
      .withExif({
        IFD0: { Make: "PhoneCo", Model: "X1" },
        IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" },
      })
      .jpeg()
      .toBuffer()
    expect((await sharp(photo).metadata()).exif).toBeDefined()
    const res = await upload(PID, { bytes: photo, name: "site.jpg", type: "image/jpeg" })
    expect(res.status).toBe(200)
    const a = await answer(res)
    const entry = bucketMod.bucket.get(a.bucket_key)!
    const bytes = bucketMod.bytesOf(entry)
    // What's stored is the cleaned file, not the upload.
    expect(bytes.equals(photo)).toBe(false)
    expect((await sharp(bytes).metadata()).exif).toBeUndefined()
    expect(a).toMatchObject({
      ok: true,
      moderation: null,
      url: `https://fake.local/r/${a.bucket_key}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size_bytes: bytes.length,
      content_type: "image/jpeg",
      name: "site.jpg",
      precomputed_sha256_matches: true,
    })
    expect(entry).toMatchObject({
      contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
    })
    const thumb = bucketMod.bucket.get(`${a.bucket_key}.thumb.webp`)!
    expect(thumb.contentType).toBe("image/webp")
    expect((await sharp(bucketMod.bytesOf(thumb)).metadata()).format).toBe("webp")
    expect(stored()).toHaveLength(2)

    // The details it answers are exactly what saving the draft checks.
    const check = await checkAttachments(
      [
        {
          key: a.bucket_key,
          name: a.name,
          sha256: a.sha256,
          content_type: a.content_type,
          size_bytes: a.size_bytes,
        },
      ],
      [],
    )
    expect(check.ok).toBe(true)
  })

  it("keeps the stored name inside the proposal's media folder and cleans the name it answers", async () => {
    const names = [
      "../../user-avatars/x\u202egnp.exe\u0000.png",
      "..\\..\\proposal.json",
      "%2e%2e%2fproposal.png",
      "photo.thumb.webp",
      "  spaced\u200b  name .png",
    ]
    const keys: string[] = []
    for (const name of names) {
      const res = await upload(PID, { bytes: await png(), name })
      expect(res.status).toBe(200)
      const a = await answer(res)
      keys.push(a.bucket_key)
      expect(ownMediaKey(a.bucket_key, NET, PID)).toBe(a.bucket_key)
      expect(a.bucket_key).toMatch(
        new RegExp(`^proposals/${NET}/${PID}/media/[0-9a-f]{8}-[A-Za-z0-9._-]+$`),
      )
      expect(a.bucket_key.endsWith(".thumb.webp")).toBe(false)
      expect(a.name).toBe(cleanAttachmentName(name))
      expect([...a.name].every((ch) => ch >= " " && ch !== "\u200b" && ch !== "\u202e")).toBe(true)
    }
    expect(keys.map((k) => k.slice(k.lastIndexOf("/") + 10))).toEqual([
      ".._.._user-avatars_x_gnp.exe_.png",
      ".._.._proposal.json",
      "2e_2e_2fproposal.png",
      "photo-thumb.webp",
      "spaced_name_.png",
    ])
    const again = await answer(await upload(PID, { bytes: await png(), name: names[0] }))
    expect(again.name).toBe("../../user-avatars/xgnp.exe.png")
    // The same name twice: two objects, the first one never overwritten.
    expect(again.bucket_key).not.toBe(keys[0])
    expect(bucketMod.bucket.has(keys[0]!)).toBe(true)
    // Nothing outside the folder was written.
    expect(bucketMod.putCalls.every((k) => k.startsWith(`proposals/${NET}/${PID}/media/`))).toBe(
      true,
    )
  })

  it("reports a storage failure without claiming success", async () => {
    bucketMod.faults.put = true
    const res = await upload(PID, { bytes: await png() })
    expect(res.status).toBe(502)
    expect((await answer(res)).ok).toBe(false)
  })
})

describe("automatic check", () => {
  it("rejects a clear violation before anything is stored", async () => {
    ai.next = verdict("block")
    const res = await upload(PID, { bytes: await png(), name: "passport.png" })
    expect(res.status).toBe(422)
    expect((await answer(res)).error).toMatch(/can't be published/)
    expect(ai.images).toEqual([{ fileName: "passport.png" }])
    expect(bucketMod.putCalls).toEqual([])
    expect(mod.states.size).toBe(0)
    expect(mod.reports).toEqual([])
  })

  it("holds a borderline file before storing it, and queues it for moderators", async () => {
    db.seedProposal({
      id: PID,
      network: NET,
      proposer_address: ALICE,
      json_key: `proposals/${NET}/${PID}/proposal.json`,
    })
    const storedWhenHeld: boolean[] = []
    mod.hooks.onSetState = (row) => void storedWhenHeld.push(bucketMod.bucket.has(row.target_id))
    ai.next = verdict("review")
    const res = await upload(PID, { bytes: await png(), name: "id.png" })
    expect(res.status).toBe(200)
    const a = await answer(res)
    expect(a.moderation).toBe("blurred")
    // Held first: the file never existed in storage without its hold.
    expect(storedWhenHeld).toEqual([false])
    expect(mod.states.get(mod.stateKey("attachment", a.bucket_key))).toMatchObject({
      state: "blurred",
      source: "automatic",
      reason: HELD_REASON,
      proposal_id: PID,
    })
    // The model's explanation goes to the moderators' queue only.
    expect(mod.reports).toMatchObject([
      {
        target_type: "attachment",
        target_id: a.bucket_key,
        source: "automatic",
        reporter_user_id: null,
        details: { decision: "review", explanation: expect.stringContaining("Jane Doe") },
      },
    ])
    expect(notices).toHaveLength(1)
    expect(mod.actions).toMatchObject([
      { action: "blur", source: "automatic", reason: HELD_REASON, actor_label: "automatic check" },
    ])

    // Not served publicly - neither the file nor its thumbnail - but moderators can look.
    expect((await read(a.bucket_key)).status).toBe(404)
    expect((await read(`${a.bucket_key}.thumb.webp`)).status).toBe(404)
    const viewMedia = () =>
      MEDIA(
        new NextRequest(
          `https://gov.test/api/moderation/media?key=${encodeURIComponent(a.bucket_key)}`,
        ),
      )
    expect((await viewMedia()).status).toBe(403)
    signIn(MOD)
    expect((await viewMedia()).status).toBe(200)

    // The public log says it was held, never why.
    const logged = await (await LOG(new NextRequest("https://gov.test/api/moderation/log"))).text()
    expect(logged).toContain(HELD_REASON)
    expect(logged).not.toContain("Jane")
    expect(logged).not.toContain("passport")
  })

  it("holds a clear violation instead of rejecting it when admins chose that", async () => {
    scanWith({ onClearViolation: "hold" })
    ai.next = verdict("block")
    const res = await upload(PID, { bytes: await png() })
    expect(res.status).toBe(200)
    const a = await answer(res)
    expect(a.moderation).toBe("blurred")
    // No draft yet: held by its key alone.
    expect(mod.states.get(mod.stateKey("attachment", a.bucket_key))).toMatchObject({
      state: "blurred",
      proposal_id: null,
    })
    expect((await read(a.bucket_key)).status).toBe(404)
  })

  it("refuses a file it must hold when the hold can't be saved", async () => {
    ai.next = verdict("review")
    mod.faults.setState = new Error("db down")
    const res = await upload(PID, { bytes: await png() })
    expect(res.status).toBe(503)
    expect(bucketMod.putCalls).toEqual([])
    expect(stored()).toEqual([])
  })

  it("holds what it can't check: long PDFs, and anything past the daily limit", async () => {
    const long = await answer(
      await upload(PID, { bytes: pdf(31), name: "long.pdf", type: "application/pdf" }),
    )
    expect(long.moderation).toBe("blurred")
    expect(ai.pdfs).toEqual([])
    mod.scanUsage.underLimit = false
    const late = await answer(await upload(PID, { bytes: await png() }))
    expect(late.moderation).toBe("blurred")
    expect(ai.images).toEqual([])
    expect(mod.reports.map((r) => r.target_id).sort()).toEqual(
      [long.bucket_key, late.bucket_key].sort(),
    )
  })

  it("sends a PDF as uploaded and stores it without a thumbnail", async () => {
    const doc = pdf(2)
    const a = await answer(
      await upload(PID, { bytes: doc, name: "budget.pdf", type: "application/pdf" }),
    )
    expect(a.moderation).toBeNull()
    expect(ai.pdfs).toHaveLength(1)
    expect(ai.pdfs[0]!.bytes.equals(doc)).toBe(true)
    expect(ai.pdfs[0]!.fileName).toBe("budget.pdf")
    expect(bucketMod.bytesOf(bucketMod.bucket.get(a.bucket_key)!).equals(doc)).toBe(true)
    expect(stored()).toEqual([a.bucket_key])
  })

  it("never blocks an upload on an outage, and checks nothing when switched off", async () => {
    ai.next = { kind: "unavailable", reason: "API 529", cause: "outage" }
    const outage = await upload(PID, { bytes: await png() })
    expect(outage.status).toBe(200)
    expect((await answer(outage)).moderation).toBeNull()
    ai.fail = true
    const thrown = await upload(PID, { bytes: await png() })
    expect(thrown.status).toBe(200)
    expect((await answer(thrown)).moderation).toBeNull()
    expect(ai.images).toHaveLength(2)
    expect(mod.states.size).toBe(0)

    scanWith({ images: false })
    ai.next = verdict("block")
    expect((await upload(PID, { bytes: await png() })).status).toBe(200)
    scanWith({ enabled: false })
    expect((await upload(PID, { bytes: await png() })).status).toBe(200)
    expect(ai.images).toHaveLength(2)
  })
})

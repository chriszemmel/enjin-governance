/**
 * Linking a draft to a referendum: the metadata binding is not enough on
 * its own - anyone can copy a draft's envelope onto their own referendum.
 * The referendum must also be filed by the draft's proposer and enact the
 * draft's call; a referendum signed from an older staged version links to
 * that version. Chain reads are faked; only I/O is mocked.
 */
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { blake2AsHex } from "@polkadot/util-crypto"
import { expectedMetadataHash } from "@/lib/governance/proposal-metadata"
import { stringifyStable } from "@/lib/r2/json"

const ALICE = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const MALLORY = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const PID = "44444444-4444-4444-8444-444444444444"
const NET = "enjin-relay"
const CALL = new Uint8Array([0, 0, 4, 0xaa])
const BASE = "https://fake.local/r"

const chain = vi.hoisted(() => ({
  metadata: null as string | null,
  ref: null as unknown,
  history: null as unknown,
}))
const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  attached: [] as unknown[],
}))
const pause = vi.hoisted(() => ({ until: null as Date | null }))

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({
    id: "alice",
    address: "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA",
  }),
}))
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true }))
vi.mock("@/lib/r2/client", () => ({
  isR2Configured: () => true,
  publicAssetBase: () => "https://fake.local/r",
  r2PublicBase: () => "https://pub.r2.dev",
}))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))
vi.mock("@/lib/moderation/auto-flag", () => ({ flagText: () => undefined }))
vi.mock("@/lib/moderation/suspension", async () => {
  const { NextResponse } = await import("next/server")
  return {
    postingSuspendedResponse: async () =>
      pause.until
        ? NextResponse.json(
            { ok: false, error: "Posting is paused for this account." },
            { status: 403 },
          )
        : null,
  }
})
vi.mock("@/lib/chain/api", () => ({
  getApi: async () => ({
    query: {
      referenda: {
        metadataOf: async () =>
          chain.metadata
            ? { isSome: true, unwrap: () => ({ toHex: () => chain.metadata }) }
            : { isSome: false },
      },
    },
  }),
}))
vi.mock("@/lib/governance/referenda", () => ({
  getReferendum: async () => chain.ref,
  getReferendumHistory: async () => chain.history,
}))
vi.mock("@/lib/db/proposals", () => ({
  getProposalById: async () => (db.row ? { ...db.row } : null),
  updateProposalDraft: async (d: Record<string, unknown>) => {
    if (!db.row || db.row.json_sha256 !== d.expectedSha256) return null
    Object.assign(db.row, {
      title: d.title,
      json_url: d.jsonUrl,
      json_key: d.jsonKey,
      json_sha256: d.jsonSha256,
      preimage_hash: d.preimageHash,
      preimage_len: d.preimageLen,
    })
    return { ...db.row }
  },
  replaceAttachments: async () => undefined,
  attachReferendumIndex: async (a: { referendumIndex: number }) => {
    db.attached.push(a)
    return { ...db.row, status: "on_chain", referendum_index: a.referendumIndex }
  },
}))

import * as bucket from "./fake-bucket"
import { POST } from "@/app/api/proposals/[uuid]/confirm/route"

/** Store one version of the draft's JSON; returns its key, url and hash. */
function storeVersion(title: string, base = BASE) {
  const text = stringifyStable({
    title,
    summary: null,
    body_markdown: "text",
    track: null,
    spend: null,
    attachments: [],
    preimage_hash: blake2AsHex(CALL, 256),
    preimage_len: CALL.length,
  })
  const sha = createHash("sha256").update(text, "utf8").digest("hex")
  const key = `proposals/${NET}/${PID}/proposal-${sha.slice(0, 16)}.json`
  bucket.bucket.set(key, { body: text, contentType: "application/json" })
  return { key, url: `${base}/${key}`, sha }
}

const ongoing = (who: string, proposal: unknown) => ({
  index: 7,
  status: { type: "Ongoing", proposal, submissionDeposit: { who, amount: 10n } },
})
const lookup = { hash: blake2AsHex(CALL, 256), len: CALL.length }
const inline = { type: "Inline", bytes: CALL }

const confirm = () =>
  POST(
    new NextRequest(`https://gov.test/api/proposals/${PID}/confirm`, {
      method: "POST",
      body: JSON.stringify({ referendum_index: 7 }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ uuid: PID }) },
  )

let current: ReturnType<typeof storeVersion>

describe("confirm", () => {
  beforeEach(() => {
    bucket.resetBucket()
    db.attached = []
    current = storeVersion("Tooling fund")
    db.row = {
      id: PID,
      network: NET,
      proposer_address: ALICE,
      status: "draft",
      referendum_index: null,
      title: "Tooling fund",
      summary: null,
      body_markdown: "text",
      json_url: current.url,
      json_key: current.key,
      json_sha256: current.sha,
      preimage_hash: lookup.hash,
      preimage_len: lookup.len,
    }
    pause.until = null
    chain.metadata = expectedMetadataHash(current.url, current.sha)
    chain.history = null
  })

  it("is refused while the proposer's posting is paused (it would publish the draft)", async () => {
    chain.ref = ongoing(ALICE, lookup)
    pause.until = new Date(Date.now() + 86_400_000)
    expect((await confirm()).status).toBe(403)
    expect(db.attached).toHaveLength(0)
  })

  it("links a referendum the proposer filed with the draft's call", async () => {
    chain.ref = ongoing(ALICE, lookup)
    expect((await confirm()).status).toBe(200)
    expect(db.attached).toHaveLength(1)
  })

  it("compares an inline call by its bare bytes", async () => {
    chain.ref = ongoing(ALICE, inline)
    expect((await confirm()).status).toBe(200)
  })

  it("refuses someone else's referendum that copied the envelope", async () => {
    chain.ref = ongoing(MALLORY, lookup)
    const res = await confirm()
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toContain("another account")
    expect(db.attached).toHaveLength(0)
  })

  it("refuses the proposer's referendum if it enacts a different call", async () => {
    chain.ref = ongoing(ALICE, { hash: "0x" + "22".repeat(32), len: 4 })
    expect((await confirm()).status).toBe(409)
    expect(db.attached).toHaveLength(0)
  })

  it("reads a concluded referendum's filer and call from its last ongoing state", async () => {
    chain.ref = { index: 7, status: { type: "Killed", at: 100 } }
    // The archive read failed: worth another try, not a final answer.
    const unread = await confirm()
    expect(unread.status).toBe(503)
    expect(((await unread.json()) as { retryable: boolean }).retryable).toBe(true)
    chain.history = { index: 7, status: { type: "Killed", at: 99 } }
    expect((await confirm()).status).toBe(409) // no ongoing state to read: can't tell
    chain.history = ongoing(ALICE, lookup)
    expect((await confirm()).status).toBe(200)
    chain.history = ongoing(MALLORY, lookup)
    expect((await confirm()).status).toBe(409)
  })

  it("links the older version a second tab signed, and switches the draft to it", async () => {
    const signed = current
    current = storeVersion("Tooling fund, edited later")
    Object.assign(db.row!, {
      title: "Tooling fund, edited later",
      json_url: current.url,
      json_key: current.key,
      json_sha256: current.sha,
    })
    chain.metadata = expectedMetadataHash(signed.url, signed.sha)
    chain.ref = ongoing(ALICE, lookup)
    expect((await confirm()).status).toBe(200)
    expect(db.row).toMatchObject({ json_key: signed.key, title: "Tooling fund" })
  })

  it("finds an older version staged under the bucket's own URL", async () => {
    const signed = storeVersion("Tooling fund", "https://pub.r2.dev")
    current = storeVersion("Tooling fund, edited later")
    Object.assign(db.row!, {
      title: "Tooling fund, edited later",
      json_url: current.url,
      json_key: current.key,
      json_sha256: current.sha,
    })
    chain.metadata = expectedMetadataHash(signed.url, signed.sha)
    chain.ref = ongoing(ALICE, lookup)
    expect((await confirm()).status).toBe(200)
    expect(db.row).toMatchObject({ json_key: signed.key, json_url: signed.url })
  })
})

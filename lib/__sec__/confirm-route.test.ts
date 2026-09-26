/**
 * Linking a draft to a referendum: the metadata binding is not enough on
 * its own - anyone can copy a draft's envelope onto their own referendum.
 * The referendum must also be filed by the draft's proposer and enact the
 * draft's call. Chain reads are faked; only I/O is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { expectedMetadataHash } from "@/lib/governance/proposal-metadata"

const ALICE = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const MALLORY = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const PID = "44444444-4444-4444-8444-444444444444"
const ROW = {
  id: PID,
  network: "enjin-relay",
  proposer_address: ALICE,
  status: "draft",
  referendum_index: null,
  title: "Tooling fund",
  summary: null,
  body_markdown: "text",
  json_url: `https://gov.test/r/proposals/enjin-relay/${PID}/proposal-0123456789abcdef.json`,
  json_key: `proposals/enjin-relay/${PID}/proposal-0123456789abcdef.json`,
  json_sha256: "a".repeat(64),
  preimage_hash: "0x" + "11".repeat(32),
  preimage_len: 40,
}

const chain = vi.hoisted(() => ({ metadata: null as string | null, ref: null as unknown }))
const db = vi.hoisted(() => ({ attached: [] as unknown[] }))

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({
    id: "alice",
    address: "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA",
  }),
}))
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true }))
vi.mock("@/lib/r2/client", () => ({ isR2Configured: () => false }))
vi.mock("@/lib/moderation/auto-flag", () => ({ flagText: () => undefined }))
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
vi.mock("@/lib/governance/referenda", () => ({ getReferendum: async () => chain.ref }))
vi.mock("@/lib/db/proposals", () => ({
  getProposalById: async () => ({ ...ROW }),
  attachReferendumIndex: async (a: { referendumIndex: number }) => {
    db.attached.push(a)
    return { ...ROW, status: "on_chain", referendum_index: a.referendumIndex }
  },
}))

import { POST } from "@/app/api/proposals/[uuid]/confirm/route"

const ongoing = (who: string, hash = ROW.preimage_hash, len = ROW.preimage_len) => ({
  index: 7,
  status: {
    type: "Ongoing",
    proposal: { hash, len },
    submissionDeposit: { who, amount: 10n },
  },
})
const confirm = () =>
  POST(
    new NextRequest(`https://gov.test/api/proposals/${PID}/confirm`, {
      method: "POST",
      body: JSON.stringify({ referendum_index: 7 }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ uuid: PID }) },
  )

describe("confirm", () => {
  beforeEach(() => {
    chain.metadata = expectedMetadataHash(ROW.json_url, ROW.json_sha256)
    db.attached = []
  })

  it("links a referendum the proposer filed with the draft's call", async () => {
    chain.ref = ongoing(ALICE)
    expect((await confirm()).status).toBe(200)
    expect(db.attached).toHaveLength(1)
  })

  it("refuses someone else's referendum that copied the envelope", async () => {
    chain.ref = ongoing(MALLORY)
    const res = await confirm()
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toContain("another account")
    expect(db.attached).toHaveLength(0)
  })

  it("refuses the proposer's referendum if it enacts a different call", async () => {
    chain.ref = ongoing(ALICE, "0x" + "22".repeat(32))
    expect((await confirm()).status).toBe(409)
    expect(db.attached).toHaveLength(0)
  })

  it("refuses when the filer can't be told any more", async () => {
    chain.ref = { index: 7, status: { type: "Killed", at: 100 } }
    expect((await confirm()).status).toBe(409)
    expect(db.attached).toHaveLength(0)
  })
})

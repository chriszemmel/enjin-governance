/**
 * POST /api/proposals/[uuid]/confirm reads the chain on every call, so it
 * is capped per account - loosely enough for the browser's retry loop
 * (lib/governance/confirm-client.ts: up to 4 tries per confirm, plus one
 * after signing in again). The real route and in-process limiter run; the
 * session, database and chain are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const ALICE = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const PID = "44444444-4444-4444-8444-444444444444"

const io = vi.hoisted(() => ({
  me: null as null | { id: string; address: string },
  chainReads: 0,
}))

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => io.me }))
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true }))
vi.mock("@/lib/r2/client", () => ({ isR2Configured: () => true }))
vi.mock("@/lib/r2/upload", async () => await import("./fake-bucket"))
vi.mock("@/lib/moderation/auto-flag", () => ({ flagText: () => undefined }))
// No metadata on chain yet: a retryable 409 after one chain read.
vi.mock("@/lib/chain/api", () => ({
  getApi: async () => {
    io.chainReads += 1
    return { query: { referenda: { metadataOf: async () => ({ isSome: false }) } } }
  },
}))
vi.mock("@/lib/db/proposals", () => ({
  getProposalById: async () => ({
    id: PID,
    network: "enjin-relay",
    proposer_address: ALICE,
    status: "draft",
    json_url: `https://fake.local/r/proposals/enjin-relay/${PID}/proposal.json`,
    json_key: `proposals/enjin-relay/${PID}/proposal.json`,
    json_sha256: "0".repeat(64),
  }),
}))

import { __resetRateLimitStore, RATE_LIMITS } from "@/lib/rate-limit"
import { POST } from "@/app/api/proposals/[uuid]/confirm/route"

const confirm = () =>
  POST(
    new NextRequest(`https://gov.test/api/proposals/${PID}/confirm`, {
      method: "POST",
      body: JSON.stringify({ referendum_index: 7 }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ uuid: PID }) },
  )

beforeEach(() => {
  io.me = { id: "alice", address: ALICE }
  io.chainReads = 0
  for (const k of [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]) {
    vi.stubEnv(k, "")
  }
  __resetRateLimitStore()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("confirm rate limit", () => {
  it("leaves room for several full rounds of the browser's retries", () => {
    // 1 try + 3 retries + 1 after signing in again, per confirm.
    expect(RATE_LIMITS.proposalConfirm.limit).toBeGreaterThanOrEqual(5 * 5)
  })

  it("answers 429 once an account is over the limit, before reading the chain", async () => {
    for (let i = 0; i < RATE_LIMITS.proposalConfirm.limit; i += 1) {
      const res = await confirm()
      expect(res.status).toBe(409)
      expect((await res.json()).retryable).toBe(true)
    }
    expect(io.chainReads).toBe(RATE_LIMITS.proposalConfirm.limit)

    const res = await confirm()
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    // Not retryable: the browser's loop stops instead of hammering on.
    expect(await res.json()).toMatchObject({ ok: false, retryable: false })
    expect(io.chainReads).toBe(RATE_LIMITS.proposalConfirm.limit)
  })

  it("counts per account, and not for requests without a session", async () => {
    io.me = null
    for (let i = 0; i < RATE_LIMITS.proposalConfirm.limit + 1; i += 1) {
      expect((await confirm()).status).toBe(401)
    }
    io.me = { id: "alice", address: ALICE }
    for (let i = 0; i < RATE_LIMITS.proposalConfirm.limit; i += 1) await confirm()
    expect((await confirm()).status).toBe(429)
    io.me = { id: "alice-other-session-user", address: ALICE }
    expect((await confirm()).status).toBe(409)
  })
})

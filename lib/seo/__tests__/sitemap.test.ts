/**
 * app/sitemap.ts: the public pages plus one entry per referendum, from the
 * chain's count and the database rows. The database and the chain are
 * mocked; a failing or hanging source only shortens the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const io = vi.hoisted(() => ({
  dbConfigured: true,
  rows: [] as Array<{
    referendum_index: number | null
    status: string
    updated_at: Date
  }>,
  dbFails: false,
  count: 0 as number | null,
  chain: "ok" as "ok" | "fails" | "hangs",
}))

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => io.dbConfigured,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/db/proposals", () => ({
  listProposalsWithIndex: vi.fn(async () => {
    if (io.dbFails) throw new Error("db down")
    return io.rows
  }),
}))
vi.mock("@/lib/chain/api", () => ({
  getApi: vi.fn(async () => {
    if (io.chain === "fails") throw new Error("rpc down")
    if (io.chain === "hangs") return new Promise(() => {})
    return {}
  }),
}))
vi.mock("@/lib/governance/referenda", () => ({
  getReferendumCount: vi.fn(async () => io.count),
}))

import sitemap from "@/app/sitemap"
import { getApi } from "@/lib/chain/api"
import { listProposalsWithIndex } from "@/lib/db/proposals"
import { CHAIN_READ_BUDGET_MS } from "@/lib/seo/referenda"
import { defaultChain, siteUrl } from "@/lib/seo/site"

const STATIC = [
  "/",
  "/proposals",
  "/treasury",
  "/docs",
  "/moderation-log",
  "/security",
  "/imprint",
  "/privacy",
  "/terms",
]
const url = (path: string) => `${siteUrl()}${path}`
const proposalUrls = (entries: Awaited<ReturnType<typeof sitemap>>) =>
  entries.map((e) => e.url).filter((u) => u.startsWith(url("/proposals/")))

beforeEach(() => {
  vi.stubEnv("SITE_PASSWORD_STATUS", "OFF")
  io.dbConfigured = true
  io.rows = []
  io.dbFails = false
  io.count = 0
  io.chain = "ok"
  vi.mocked(getApi).mockClear()
  vi.mocked(listProposalsWithIndex).mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("sitemap.xml", () => {
  it("lists the public pages, then every referendum on the default network, newest first", async () => {
    io.count = 4
    const edited = new Date("2026-09-01T10:00:00Z")
    io.rows = [{ referendum_index: 2, status: "on_chain", updated_at: edited }]

    const entries = await sitemap()
    expect(entries.slice(0, STATIC.length).map((e) => e.url)).toEqual(STATIC.map(url))
    expect(proposalUrls(entries)).toEqual([3, 2, 1, 0].map((i) => url(`/proposals/${i}`)))
    expect(vi.mocked(listProposalsWithIndex)).toHaveBeenCalledWith(defaultChain().id)

    const byUrl = new Map(entries.map((e) => [e.url, e]))
    // A real date only where we have one.
    expect(byUrl.get(url("/proposals/2"))?.lastModified).toEqual(edited)
    expect(byUrl.get(url("/proposals/3"))).not.toHaveProperty("lastModified")
    expect(byUrl.get(url("/"))).not.toHaveProperty("lastModified")
    expect(byUrl.get(url("/"))).toMatchObject({ priority: 1, changeFrequency: "daily" })
    expect(byUrl.get(url("/proposals/3"))).toMatchObject({ priority: 0.7 })
    // The moderation queue and other private areas are never listed.
    for (const e of entries)
      expect(e.url).not.toMatch(/\/(moderation|account|create|unlock|api)(\/|$)/)
  })

  it("skips rows that aren't public or point past the chain's count", async () => {
    io.count = 3
    const at = new Date("2026-09-01T10:00:00Z")
    io.rows = [
      { referendum_index: 1, status: "failed", updated_at: at },
      { referendum_index: 7, status: "on_chain", updated_at: at },
      { referendum_index: null, status: "draft", updated_at: at },
    ]
    const entries = await sitemap()
    expect(proposalUrls(entries)).toEqual([2, 1, 0].map((i) => url(`/proposals/${i}`)))
    expect(entries.every((e) => e.lastModified == null)).toBe(true)
  })

  it("still lists the database's referenda when the chain is down", async () => {
    io.chain = "fails"
    const at = new Date("2026-09-01T10:00:00Z")
    io.rows = [
      { referendum_index: 5, status: "on_chain", updated_at: at },
      { referendum_index: 9, status: "on_chain", updated_at: at },
    ]
    expect(proposalUrls(await sitemap())).toEqual([url("/proposals/9"), url("/proposals/5")])
  })

  it("doesn't wait for a chain that doesn't answer", async () => {
    vi.useFakeTimers()
    io.chain = "hangs"
    io.rows = [{ referendum_index: 5, status: "on_chain", updated_at: new Date() }]
    const pending = sitemap()
    await vi.advanceTimersByTimeAsync(CHAIN_READ_BUDGET_MS)
    expect(proposalUrls(await pending)).toEqual([url("/proposals/5")])
  })

  it("still lists the chain's referenda when the database is down or not configured", async () => {
    io.count = 2
    io.dbFails = true
    expect(proposalUrls(await sitemap())).toEqual([url("/proposals/1"), url("/proposals/0")])

    io.dbFails = false
    io.dbConfigured = false
    expect(proposalUrls(await sitemap())).toEqual([url("/proposals/1"), url("/proposals/0")])
    expect(vi.mocked(listProposalsWithIndex)).toHaveBeenCalledTimes(1)
  })

  it("falls back to the public pages when both sources fail", async () => {
    io.chain = "fails"
    io.dbFails = true
    expect((await sitemap()).map((e) => e.url)).toEqual(STATIC.map(url))
  })

  it("ignores a count that isn't a sane number", async () => {
    io.count = -1
    expect((await sitemap()).map((e) => e.url)).toEqual(STATIC.map(url))
  })

  it("is empty while the password gate is on, without touching the database or chain", async () => {
    vi.stubEnv("SITE_PASSWORD_STATUS", "ON")
    io.count = 4
    expect(await sitemap()).toEqual([])
    expect(vi.mocked(getApi)).not.toHaveBeenCalled()
    expect(vi.mocked(listProposalsWithIndex)).not.toHaveBeenCalled()
  })
})

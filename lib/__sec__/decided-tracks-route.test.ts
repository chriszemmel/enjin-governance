/**
 * GET /api/chain/[chain]/decided-tracks: the tracks of decided referenda,
 * read once and cached. A complete answer is cached at the CDN; a partial
 * one (a read failed) is not, so nobody keeps getting the gap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const reads: number[] = []
let failing = new Set<number>()

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => fn,
}))
vi.mock("@/lib/chain/api", () => ({ getApi: async () => ({}) }))
vi.mock("@/lib/governance/referenda", () => ({
  listReferenda: async () => [
    { index: 15, status: { type: "Ongoing" }, trackId: 203 },
    { index: 13, status: { type: "Approved", at: 17_500_011 }, trackId: null },
    { index: 12, status: { type: "Approved", at: 17_533_282 }, trackId: null },
    { index: 10, status: { type: "Approved", at: 16_880_927 }, trackId: null },
  ],
  getDecidedTrack: async (_api: unknown, index: number) => {
    reads.push(index)
    if (failing.has(index)) return null
    return { 13: 200, 12: 203, 10: 0 }[index] ?? null
  },
}))

import { GET } from "@/app/api/chain/[chain]/decided-tracks/route"

const call = (chain: string) =>
  GET(new Request(`https://gov.test/api/chain/${chain}/decided-tracks`), {
    params: Promise.resolve({ chain }),
  })

beforeEach(() => {
  reads.length = 0
  failing = new Set()
})

describe("decided-tracks route", () => {
  it("returns every decided referendum's track, one read at a time, cached at the CDN", async () => {
    const res = await call("enjin-relay")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tracks: { 10: 0, 12: 203, 13: 200 }, complete: true })
    expect(reads).toEqual([10, 12, 13])
    expect(res.headers.get("cache-control")).toContain("s-maxage")
  })

  it("leaves out what it couldn't read and isn't cached then", async () => {
    failing = new Set([12])
    const res = await call("enjin-relay")
    expect(await res.json()).toEqual({ tracks: { 10: 0, 13: 200 }, complete: false })
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("refuses an unknown chain", async () => {
    expect((await call("nope")).status).toBe(400)
  })

  it("refuses prototype property names, which are not chains either", async () => {
    // `"constructor" in CHAINS` is true; the route must check own properties,
    // or it reads `undefined.rpc` and connects to the provider's default
    // endpoint (ws://127.0.0.1:9944) for ten seconds.
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect((await call(name)).status, name).toBe(400)
    }
  })
})

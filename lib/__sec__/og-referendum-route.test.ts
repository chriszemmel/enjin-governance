/**
 * GET /og/referendum/[network]/[index]: a referendum's share image. Only
 * enabled networks and valid numbers render; a card the chain couldn't fill
 * is cached briefly instead of for a day.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const loaded = vi.fn()
vi.mock("@/lib/og/referendum-data", () => ({ loadReferendumCard: (...a: unknown[]) => loaded(...a) }))
vi.mock("@/lib/og/referendum-card", () => ({
  renderReferendumCard: async (card: unknown, headers: Record<string, string>) =>
    new Response(JSON.stringify(card), { headers }),
}))

import { GET } from "@/app/og/referendum/[network]/[index]/route"

const call = (network: string, index: string) =>
  GET(new Request(`https://gov.test/og/referendum/${network}/${index}`), {
    params: Promise.resolve({ network, index }),
  })

beforeEach(() => loaded.mockReset())

describe("referendum share image route", () => {
  it("renders a complete card and lets the CDN keep it for a day", async () => {
    loaded.mockResolvedValue({ index: 15, title: "T", track: "Medium Spender", fact: null, complete: true })
    const res = await call("enjin-relay", "15")
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("s-maxage=86400")
    expect(loaded).toHaveBeenCalledWith(expect.objectContaining({ id: "enjin-relay" }), 15)
  })

  it("keeps a card the chain couldn't fill for five minutes only", async () => {
    loaded.mockResolvedValue({ index: 15, title: null, track: null, fact: null, complete: false })
    expect((await call("enjin-relay", "15")).headers.get("cache-control")).toContain("s-maxage=300")
  })

  it("refuses unknown or disabled networks and bad numbers without reading anything", async () => {
    for (const [network, index] of [
      ["nope", "1"],
      ["constructor", "1"],
      ["__proto__", "1"],
      ["enjin-matrix", "1"],
      ["enjin-relay", "-1"],
      ["enjin-relay", "1e3"],
    ]) {
      expect((await call(network!, index!)).status, `${network}/${index}`).toBe(404)
    }
    expect(loaded).not.toHaveBeenCalled()
  })
})

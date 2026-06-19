import { describe, expect, it } from "vitest"
import {
  CHAINS,
  enabledChains,
  getChain,
  subscanAccountUrl,
  subscanExtrinsicUrl,
  subscanReferendumUrl,
} from "@/lib/chain/chains"
import { getActiveChain } from "@/lib/chain/use-chain"

describe("CHAINS registry", () => {
  it("declares the four expected chains", () => {
    expect(Object.keys(CHAINS).sort()).toEqual([
      "canary-matrix",
      "canary-relay",
      "enjin-matrix",
      "enjin-relay",
    ])
  })

  it("uses well-formed CAIP-2 ids (polkadot:<32-hex>)", () => {
    for (const chain of Object.values(CHAINS)) {
      expect(chain.caip2).toMatch(/^polkadot:[0-9a-f]{32}$/)
    }
  })

  it("has correct Enjin Relay metadata", () => {
    const relay = CHAINS["enjin-relay"]
    expect(relay.ss58Prefix).toBe(2135)
    expect(relay.decimals).toBe(18)
    expect(relay.ticker).toBe("ENJ")
    expect(relay.enabled).toBe(true)
    expect(relay.isTestnet).toBe(false)
  })

  it("has correct Enjin Matrix metadata", () => {
    const matrix = CHAINS["enjin-matrix"]
    expect(matrix.ss58Prefix).toBe(1110)
    expect(matrix.decimals).toBe(18)
    expect(matrix.enabled).toBe(false)
  })

  it("flags canary chains as testnets with cENJ ticker", () => {
    expect(CHAINS["canary-relay"].isTestnet).toBe(true)
    expect(CHAINS["canary-relay"].ticker).toBe("cENJ")
    expect(CHAINS["canary-matrix"].isTestnet).toBe(true)
  })

  it("uses Canary's own SS58 prefixes (cn… on relay, runtime-declared)", () => {
    // Mirrors the values returned by `api.consts.system.ss58Prefix` on the
    // live canary chains. Without these, wallet-returned addresses would
    // display under the wrong prefix (`en…` instead of `cn…`).
    expect(CHAINS["canary-relay"].ss58Prefix).toBe(69)
    expect(CHAINS["canary-matrix"].ss58Prefix).toBe(9030)
  })
})

describe("getChain", () => {
  it("returns the requested chain", () => {
    expect(getChain("enjin-relay").id).toBe("enjin-relay")
  })

  it("throws on unknown id", () => {
    // @ts-expect-error - exercising runtime guard with invalid input
    expect(() => getChain("nonsense")).toThrow()
  })
})

describe("getActiveChain", () => {
  it("returns a chain config", () => {
    const active = getActiveChain()
    expect(active).toBeDefined()
    expect(active.enabled).toBe(true)
  })
})

describe("enabledChains", () => {
  it("returns only chains with enabled=true", () => {
    const enabled = enabledChains()
    expect(enabled.length).toBeGreaterThan(0)
    for (const chain of enabled) {
      expect(chain.enabled).toBe(true)
    }
  })

  it("excludes Matrix (disabled in MVP)", () => {
    const enabled = enabledChains().map((c) => c.id)
    expect(enabled).not.toContain("enjin-matrix")
  })
})

describe("Subscan URL builders", () => {
  const relay = CHAINS["enjin-relay"]

  it("builds referendum URLs", () => {
    expect(subscanReferendumUrl(relay, 42)).toBe("https://enjin.subscan.io/referenda_v2/42")
  })

  it("builds account URLs", () => {
    const addr = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
    expect(subscanAccountUrl(relay, addr)).toBe(`https://enjin.subscan.io/account/${addr}`)
  })

  it("builds extrinsic URLs", () => {
    const hash = "0x" + "ab".repeat(32)
    expect(subscanExtrinsicUrl(relay, hash)).toBe(`https://enjin.subscan.io/extrinsic/${hash}`)
  })
})

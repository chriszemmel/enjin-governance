import { describe, expect, it } from "vitest"
import {
  assertTierCoversAmount,
  ENJIN_TREASURY_TIERS,
  maxTreasurySpend,
  pickOriginForAmount,
} from "@/lib/governance/treasury"
import type { TreasuryTier } from "@/lib/governance/types"

const ENJ = (n: number | bigint) => BigInt(n) * 10n ** 18n

describe("pickOriginForAmount with ENJIN_TREASURY_TIERS", () => {
  it("returns SmallTipper for tiny amounts", () => {
    expect(pickOriginForAmount(ENJ(1))?.origin).toBe("SmallTipper")
    expect(pickOriginForAmount(ENJ(250))?.origin).toBe("SmallTipper")
  })

  it("picks the smallest tier that covers the amount", () => {
    expect(pickOriginForAmount(ENJ(251))?.origin).toBe("BigTipper")
    expect(pickOriginForAmount(ENJ(1_000))?.origin).toBe("BigTipper")
    expect(pickOriginForAmount(ENJ(1_001))?.origin).toBe("SmallSpender")
    expect(pickOriginForAmount(ENJ(10_000))?.origin).toBe("SmallSpender")
    expect(pickOriginForAmount(ENJ(100_001))?.origin).toBe("BigSpender")
    expect(pickOriginForAmount(ENJ(1_000_000))?.origin).toBe("BigSpender")
  })

  it("returns null above the BigSpender cap (no unbounded fallback)", () => {
    // Enjin has no Treasurer track; BigSpender caps at 1,000,000 ENJ and we
    // reject anything larger rather than file an un-enactable referendum.
    expect(pickOriginForAmount(ENJ(1_000_001))).toBeNull()
    expect(pickOriginForAmount(ENJ(10_000_000_000))).toBeNull()
  })

  it("returns null for negative amounts", () => {
    expect(pickOriginForAmount(-1n)).toBeNull()
  })

  it("returns null when no tier is unbounded and amount exceeds all", () => {
    const boundedOnly: TreasuryTier[] = [
      { origin: "Tiny", maxAmount: 100n },
      { origin: "Small", maxAmount: 1_000n },
    ]
    expect(pickOriginForAmount(50n, boundedOnly)?.origin).toBe("Tiny")
    expect(pickOriginForAmount(999n, boundedOnly)?.origin).toBe("Small")
    expect(pickOriginForAmount(1_001n, boundedOnly)).toBeNull()
  })

  it("returns SmallTipper at zero amount (boundary)", () => {
    expect(pickOriginForAmount(0n)?.origin).toBe("SmallTipper")
  })
})

// The treasury spend origins the deployed Enjin Relay runtime (enjin v1070)
// actually exposes in its `Origins` enum. Treasurer is intentionally NOT here
// - Enjin has no such track, so filing under it is un-encodable.
const ENJIN_RUNTIME_SPEND_ORIGINS = new Set([
  "SmallTipper",
  "BigTipper",
  "SmallSpender",
  "MediumSpender",
  "BigSpender",
])

describe("ENJIN_TREASURY_TIERS shape", () => {
  it("starts with SmallTipper and ends with BigSpender capped at 1,000,000 ENJ", () => {
    expect(ENJIN_TREASURY_TIERS[0]?.origin).toBe("SmallTipper")
    const last = ENJIN_TREASURY_TIERS[ENJIN_TREASURY_TIERS.length - 1]
    expect(last?.origin).toBe("BigSpender")
    expect(last?.maxAmount).toBe(1_000_000n * 10n ** 18n)
  })

  it("has no unbounded tier (every cap is finite)", () => {
    for (const tier of ENJIN_TREASURY_TIERS) {
      expect(tier.maxAmount).not.toBeNull()
    }
  })

  it("only references origins that exist on the runtime (no phantom Treasurer)", () => {
    for (const tier of ENJIN_TREASURY_TIERS) {
      expect(ENJIN_RUNTIME_SPEND_ORIGINS.has(tier.origin)).toBe(true)
    }
  })

  it("is monotonically increasing in maxAmount before the unbounded tier", () => {
    let prev = 0n
    for (const tier of ENJIN_TREASURY_TIERS) {
      if (tier.maxAmount === null) break
      expect(tier.maxAmount).toBeGreaterThan(prev)
      prev = tier.maxAmount
    }
  })
})

describe("maxTreasurySpend", () => {
  it("returns the BigSpender cap (1,000,000 ENJ) for the Enjin table", () => {
    expect(maxTreasurySpend()).toBe(1_000_000n * 10n ** 18n)
  })

  it("returns null when a tier is unbounded", () => {
    expect(
      maxTreasurySpend([
        { origin: "A", maxAmount: 100n },
        { origin: "B", maxAmount: null },
      ]),
    ).toBeNull()
  })

  it("is exactly the boundary pickOriginForAmount accepts", () => {
    const cap = maxTreasurySpend()!
    expect(pickOriginForAmount(cap)).not.toBeNull()
    expect(pickOriginForAmount(cap + 1n)).toBeNull()
  })
})

describe("assertTierCoversAmount", () => {
  const bounded: TreasuryTier = { origin: "SmallTipper", maxAmount: 250n }
  const unbounded: TreasuryTier = { origin: "Treasurer", maxAmount: null }

  it("passes when the amount is within the tier cap", () => {
    expect(() => assertTierCoversAmount(bounded, 250n)).not.toThrow()
    expect(() => assertTierCoversAmount(bounded, 1n)).not.toThrow()
  })

  it("throws when the amount exceeds the tier cap", () => {
    expect(() => assertTierCoversAmount(bounded, 251n)).toThrow(/SmallTipper/)
  })

  it("always passes for an unbounded (Treasurer) tier", () => {
    expect(() => assertTierCoversAmount(unbounded, 10n ** 30n)).not.toThrow()
  })

  it("agrees with pickOriginForAmount across the canonical tiers", () => {
    const ENJ18 = 10n ** 18n
    for (const amount of [1n, 250n * ENJ18, 5_000n * ENJ18, 1_000_000n * ENJ18]) {
      const tier = pickOriginForAmount(amount)!
      expect(tier).not.toBeNull()
      expect(() => assertTierCoversAmount(tier, amount)).not.toThrow()
    }
  })
})

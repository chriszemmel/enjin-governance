import { describe, expect, it } from "vitest"
import {
  assertTierCoversAmount,
  ENJIN_SPEND_LIMITS,
  maxTreasurySpend,
  pickOriginForAmount,
  TREASURY_SPEND_ORIGINS,
  treasuryTiersForSpec,
  type SpendLimits,
} from "@/lib/governance/treasury"
import type { TreasuryTier } from "@/lib/governance/types"

const ENJ = (n: number | bigint) => BigInt(n) * 10n ** 18n

const SPEC_1070 = treasuryTiersForSpec(1070)!.tiers
const SPEC_1080 = treasuryTiersForSpec(1080)!.tiers

const limitOf = (tiers: readonly TreasuryTier[], origin: string) =>
  tiers.find((t) => t.origin === origin)?.maxAmount

describe("pickOriginForAmount on spec 1070", () => {
  it("returns SmallTipper for tiny amounts", () => {
    expect(pickOriginForAmount(ENJ(1), SPEC_1070)?.origin).toBe("SmallTipper")
    expect(pickOriginForAmount(ENJ(100), SPEC_1070)?.origin).toBe("SmallTipper")
  })

  it("files 101-250 ENJ under BigTipper, not SmallTipper", () => {
    // Regression: SmallTipper used to cover up to 250 ENJ, but its spend limit
    // on spec 1070 is 100 ENJ - such a referendum passed the vote and then
    // failed spend_local with InsufficientPermission at enactment.
    expect(pickOriginForAmount(ENJ(100) + 1n, SPEC_1070)?.origin).toBe("BigTipper")
    expect(pickOriginForAmount(ENJ(250), SPEC_1070)?.origin).toBe("BigTipper")
  })

  it("picks the smallest tier that covers the amount", () => {
    expect(pickOriginForAmount(ENJ(5_000), SPEC_1070)?.origin).toBe("BigTipper")
    expect(pickOriginForAmount(ENJ(5_001), SPEC_1070)?.origin).toBe("SmallSpender")
    expect(pickOriginForAmount(ENJ(50_000), SPEC_1070)?.origin).toBe("SmallSpender")
    expect(pickOriginForAmount(ENJ(50_001), SPEC_1070)?.origin).toBe("MediumSpender")
    expect(pickOriginForAmount(ENJ(250_000), SPEC_1070)?.origin).toBe("MediumSpender")
    expect(pickOriginForAmount(ENJ(250_001), SPEC_1070)?.origin).toBe("BigSpender")
    expect(pickOriginForAmount(ENJ(2_500_000), SPEC_1070)?.origin).toBe("BigSpender")
    expect(pickOriginForAmount(ENJ(2_500_001), SPEC_1070)?.origin).toBe("TreasuryAdmin")
    expect(pickOriginForAmount(ENJ(25_000_000), SPEC_1070)?.origin).toBe("TreasuryAdmin")
  })

  it("returns null above the TreasuryAdmin cap (no unbounded fallback)", () => {
    // TreasuryAdmin caps at 25,000,000 ENJ and we reject anything larger
    // rather than file an un-enactable referendum.
    expect(pickOriginForAmount(ENJ(25_000_000) + 1n, SPEC_1070)).toBeNull()
    expect(pickOriginForAmount(ENJ(10_000_000_000), SPEC_1070)).toBeNull()
  })

  it("returns null for negative amounts", () => {
    expect(pickOriginForAmount(-1n, SPEC_1070)).toBeNull()
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
    expect(pickOriginForAmount(0n, SPEC_1070)?.origin).toBe("SmallTipper")
  })
})

describe("pickOriginForAmount on spec 1080", () => {
  it("uses the raised tipper limits", () => {
    expect(pickOriginForAmount(ENJ(2_500), SPEC_1080)?.origin).toBe("SmallTipper")
    expect(pickOriginForAmount(ENJ(2_500) + 1n, SPEC_1080)?.origin).toBe("BigTipper")
    expect(pickOriginForAmount(ENJ(10_000), SPEC_1080)?.origin).toBe("BigTipper")
    expect(pickOriginForAmount(ENJ(10_000) + 1n, SPEC_1080)?.origin).toBe("SmallSpender")
  })
})

describe("treasuryTiersForSpec", () => {
  it("keeps spec 1070's own limits on 1070, since 1080 only raises them", () => {
    const table = treasuryTiersForSpec(1070)!
    expect(table.verified).toBe(true)
    expect(table.limitsSpecVersion).toBe(1070)
    expect(table.tiers).toEqual(ENJIN_SPEND_LIMITS[0].tiers)
  })

  it("uses spec 1080's limits on 1080", () => {
    const table = treasuryTiersForSpec(1080)!
    expect(table.verified).toBe(true)
    expect(limitOf(table.tiers, "SmallTipper")).toBe(ENJ(2_500))
    expect(limitOf(table.tiers, "BigTipper")).toBe(ENJ(10_000))
  })

  it("flags an unlisted newer spec as unverified and uses the newest limits", () => {
    const table = treasuryTiersForSpec(1090)!
    expect(table.verified).toBe(false)
    expect(table.limitsSpecVersion).toBe(1080)
    expect(table.tiers).toEqual(SPEC_1080)
  })

  it("treats a spec between two listed ones as the older one, unverified", () => {
    const table = treasuryTiersForSpec(1071)!
    expect(table.verified).toBe(false)
    expect(table.limitsSpecVersion).toBe(1070)
    expect(table.tiers).toEqual(SPEC_1070)
  })

  it("returns null for a spec older than every listed one", () => {
    expect(treasuryTiersForSpec(1060)).toBeNull()
  })

  it("holds a chain to a lower limit from a later listed spec", () => {
    // A referendum filed now may enact after the upgrade, so a later cut
    // applies already.
    const limits: SpendLimits[] = [
      {
        specVersion: 1,
        tiers: [
          { origin: "A", maxAmount: 100n },
          { origin: "B", maxAmount: 1_000n },
        ],
      },
      {
        specVersion: 2,
        tiers: [
          { origin: "A", maxAmount: 50n },
          { origin: "B", maxAmount: 2_000n },
        ],
      },
    ]
    expect(treasuryTiersForSpec(1, limits)!.tiers).toEqual([
      { origin: "A", maxAmount: 50n },
      { origin: "B", maxAmount: 1_000n },
    ])
    expect(treasuryTiersForSpec(2, limits)!.tiers).toEqual(limits[1].tiers)
  })

  it("returns the same table for the same spec", () => {
    expect(treasuryTiersForSpec(1080)).toBe(treasuryTiersForSpec(1080))
  })
})

describe("ENJIN_SPEND_LIMITS shape", () => {
  it("lists specs oldest first", () => {
    const specs = ENJIN_SPEND_LIMITS.map((l) => l.specVersion)
    expect(specs).toEqual([...specs].sort((a, b) => a - b))
  })

  it("lists the same origins, smallest first, in every spec", () => {
    // There is no `Treasurer` origin - TreasuryAdmin is Enjin's counterpart.
    expect(TREASURY_SPEND_ORIGINS).toEqual([
      "SmallTipper",
      "BigTipper",
      "SmallSpender",
      "MediumSpender",
      "BigSpender",
      "TreasuryAdmin",
    ])
    for (const { tiers } of ENJIN_SPEND_LIMITS) {
      expect(tiers.map((t) => t.origin)).toEqual(TREASURY_SPEND_ORIGINS)
    }
  })

  it("has no unbounded tier (every cap is finite)", () => {
    for (const { tiers } of ENJIN_SPEND_LIMITS) {
      for (const tier of tiers) {
        expect(tier.maxAmount).not.toBeNull()
      }
    }
  })

  it("is monotonically increasing in maxAmount", () => {
    for (const { tiers } of ENJIN_SPEND_LIMITS) {
      let prev = 0n
      for (const tier of tiers) {
        expect(tier.maxAmount).toBeGreaterThan(prev)
        prev = tier.maxAmount!
      }
    }
  })
})

describe("maxTreasurySpend", () => {
  it("returns the TreasuryAdmin cap (25,000,000 ENJ) on every listed spec", () => {
    for (const { specVersion } of ENJIN_SPEND_LIMITS) {
      expect(maxTreasurySpend(treasuryTiersForSpec(specVersion)!.tiers)).toBe(ENJ(25_000_000))
    }
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
    const cap = maxTreasurySpend(SPEC_1070)!
    expect(pickOriginForAmount(cap, SPEC_1070)).not.toBeNull()
    expect(pickOriginForAmount(cap + 1n, SPEC_1070)).toBeNull()
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
    for (const amount of [1n, ENJ(100), ENJ(250), ENJ(5_000), ENJ(2_500_000), ENJ(25_000_000)]) {
      const tier = pickOriginForAmount(amount, SPEC_1070)!
      expect(tier).not.toBeNull()
      expect(() => assertTierCoversAmount(tier, amount)).not.toThrow()
    }
  })
})

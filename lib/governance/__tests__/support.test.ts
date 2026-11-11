import { describe, expect, it } from "vitest"
import {
  supportBasisForSpec,
  supportDenominator,
  supportFraction,
  TOTAL_ISSUANCE_SUPPORT_SPEC,
} from "@/lib/governance/support"

const ENJ = 10n ** 18n
// Mainnet, spec 1070 (read from wss://archive.relay.blockchain.enjin.io).
const TOTAL = 2_028_814_825_839_183_471_269_295_599n
const INACTIVE = 574_961_866_632_434_369_987_552_660n

describe("supportBasisForSpec", () => {
  it("measures against active issuance before 1080", () => {
    expect(supportBasisForSpec(1070)).toBe("active")
    expect(supportBasisForSpec(1079)).toBe("active")
  })

  it("measures against total issuance from 1080", () => {
    expect(TOTAL_ISSUANCE_SUPPORT_SPEC).toBe(1080)
    expect(supportBasisForSpec(1080)).toBe("total")
    expect(supportBasisForSpec(1090)).toBe("total")
  })
})

describe("supportDenominator", () => {
  it("spec 1070: total minus inactive issuance", () => {
    expect(supportDenominator(1070, TOTAL, INACTIVE)).toBe(TOTAL - INACTIVE)
  })

  it("spec 1080: total issuance, inactive ignored", () => {
    expect(supportDenominator(1080, TOTAL, INACTIVE)).toBe(TOTAL)
  })

  it("never negative", () => {
    expect(supportDenominator(1070, 1n, 2n)).toBe(0n)
  })

  it("referendum #15 on 1070: 33.9% of active issuance is 24.3% of total", () => {
    // 33.9% of active issuance, the share it held when it started confirming.
    const support = ((TOTAL - INACTIVE) * 339n) / 1000n
    const active = supportFraction(support, supportDenominator(1070, TOTAL, INACTIVE))!
    const ofTotal = supportFraction(support, supportDenominator(1080, TOTAL, INACTIVE))!
    expect(active).toBeCloseTo(0.339, 3)
    expect(ofTotal).toBeCloseTo(0.243, 3)
    // Against a 32.3% requirement it passes on 1070, but the old total-
    // issuance figure would have called it short.
    expect(active).toBeGreaterThan(0.323)
    expect(ofTotal).toBeLessThan(0.323)
  })
})

describe("supportFraction", () => {
  it("is null for a zero denominator", () => {
    expect(supportFraction(5n * ENJ, 0n)).toBeNull()
  })

  it("divides precisely", () => {
    expect(supportFraction(1n * ENJ, 4n * ENJ)).toBe(0.25)
  })
})

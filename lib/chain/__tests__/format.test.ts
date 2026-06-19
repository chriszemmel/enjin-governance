import { describe, expect, it } from "vitest"
import {
  blocksToSeconds,
  formatBlockDuration,
  formatTokenAmount,
  formatTokenAmountCompact,
  parseTokenAmount,
  planckToString,
} from "@/lib/chain/format"
import { CHAINS } from "@/lib/chain/chains"

const enjinRelay = CHAINS["enjin-relay"]

describe("planckToString", () => {
  it("formats whole units cleanly", () => {
    expect(planckToString(0n, 18)).toBe("0")
    expect(planckToString(10n ** 18n, 18)).toBe("1")
    expect(planckToString(42n * 10n ** 18n, 18)).toBe("42")
  })

  it("formats fractions, stripping trailing zeros", () => {
    expect(planckToString(1_500_000_000_000_000_000n, 18)).toBe("1.5")
    expect(planckToString(100_000_000_000_000_000n, 18)).toBe("0.1")
    expect(planckToString(1n, 18)).toBe("0.000000000000000001")
  })

  it("handles zero decimals", () => {
    expect(planckToString(1234n, 0)).toBe("1234")
  })

  it("handles negative values (e.g. account-delta queries)", () => {
    expect(planckToString(-1_500_000_000_000_000_000n, 18)).toBe("-1.5")
  })

  it("throws on non-integer or negative decimals", () => {
    expect(() => planckToString(1n, -1)).toThrow()
    expect(() => planckToString(1n, 1.5)).toThrow()
  })
})

describe("formatTokenAmount", () => {
  it("truncates fractional digits and appends ticker by default", () => {
    expect(formatTokenAmount(1_234_567_890_000_000_000n, enjinRelay)).toBe("1.2345 ENJ")
  })

  it("respects maxFractionDigits", () => {
    expect(
      formatTokenAmount(1_234_567_890_000_000_000n, enjinRelay, { maxFractionDigits: 2 }),
    ).toBe("1.23 ENJ")
  })

  it("never rounds up - truncates toward zero", () => {
    // 1.99999999... should display as "1.9999" not "2.0000"
    expect(
      formatTokenAmount(1_999_999_999_999_999_999n, enjinRelay, { maxFractionDigits: 4 }),
    ).toBe("1.9999 ENJ")
  })

  it("inserts thousands separators in the whole part", () => {
    expect(formatTokenAmount(1_234_567n * 10n ** 18n, enjinRelay)).toBe("1,234,567 ENJ")
  })

  it("omits ticker when asked", () => {
    expect(formatTokenAmount(10n ** 18n, enjinRelay, { withTicker: false })).toBe("1")
  })

  it("omits the trailing dot when fraction is all zeros", () => {
    expect(formatTokenAmount(5n * 10n ** 18n, enjinRelay)).toBe("5 ENJ")
  })
})

describe("formatTokenAmountCompact", () => {
  it("uses K/M/B suffixes", () => {
    expect(formatTokenAmountCompact(1_500_000n * 10n ** 18n, enjinRelay)).toBe("1.50M ENJ")
    expect(formatTokenAmountCompact(412_500n * 10n ** 18n, enjinRelay)).toBe("412.5K ENJ")
    expect(formatTokenAmountCompact(85n * 10n ** 18n, enjinRelay)).toBe("85 ENJ")
  })

  it("handles billions", () => {
    expect(formatTokenAmountCompact(2_400_000_000n * 10n ** 18n, enjinRelay)).toBe("2.40B ENJ")
  })
})

describe("parseTokenAmount", () => {
  it("parses whole numbers", () => {
    expect(parseTokenAmount("1", enjinRelay)).toBe(10n ** 18n)
    expect(parseTokenAmount("42", enjinRelay)).toBe(42n * 10n ** 18n)
  })

  it("parses fractional input", () => {
    expect(parseTokenAmount("1.5", enjinRelay)).toBe(1_500_000_000_000_000_000n)
    expect(parseTokenAmount("0.000001", enjinRelay)).toBe(1_000_000_000_000n)
  })

  it("accepts comma as the decimal separator", () => {
    expect(parseTokenAmount("1,5", enjinRelay)).toBe(1_500_000_000_000_000_000n)
    expect(parseTokenAmount("0,1 ENJ", enjinRelay)).toBe(100_000_000_000_000_000n)
  })

  it("strips an optional trailing ticker", () => {
    expect(parseTokenAmount("1.5 ENJ", enjinRelay)).toBe(1_500_000_000_000_000_000n)
    expect(parseTokenAmount("1.5 enj", enjinRelay)).toBe(1_500_000_000_000_000_000n)
  })

  it("rejects invalid input", () => {
    expect(() => parseTokenAmount("", enjinRelay)).toThrow()
    expect(() => parseTokenAmount("-1", enjinRelay)).toThrow()
    expect(() => parseTokenAmount("1e3", enjinRelay)).toThrow()
    expect(() => parseTokenAmount("abc", enjinRelay)).toThrow()
  })

  it("rejects too many decimal places", () => {
    // 18 decimals max for ENJ
    expect(() => parseTokenAmount("1.1234567890123456789", enjinRelay)).toThrow()
  })

  it("round-trips with planckToString", () => {
    const inputs = ["0", "1", "1.5", "0.000001", "1234567", "0.000000000000000001"]
    for (const input of inputs) {
      const planck = parseTokenAmount(input, enjinRelay)
      expect(planckToString(planck, enjinRelay.decimals)).toBe(input === "0" ? "0" : input)
    }
  })
})

describe("blocksToSeconds + formatBlockDuration", () => {
  it("uses 6s block time by default", () => {
    expect(blocksToSeconds(10)).toBe(60)
    expect(blocksToSeconds(600)).toBe(3_600)
  })

  it("formats day-scale durations", () => {
    // 14_400 blocks @ 6s = 86_400s = 1 day
    expect(formatBlockDuration(14_400)).toBe("1d")
    // 28 days at 6s blocks = 28 * 14400 blocks
    expect(formatBlockDuration(28 * 14_400)).toBe("28d")
  })

  it("includes hours when day-with-remainder", () => {
    // 1 day + 3 hours = (14400 + 1800) blocks
    expect(formatBlockDuration(14_400 + 1_800)).toBe("1d 3h")
  })

  it("formats hour-scale durations", () => {
    expect(formatBlockDuration(600)).toBe("1h")
    expect(formatBlockDuration(900)).toBe("1h 30m")
  })

  it("formats minute and second scales", () => {
    expect(formatBlockDuration(10)).toBe("1m")
    expect(formatBlockDuration(5)).toBe("30s")
  })

  it("returns em-dash for non-positive blocks", () => {
    expect(formatBlockDuration(0)).toBe("-")
    expect(formatBlockDuration(-100)).toBe("-")
  })
})

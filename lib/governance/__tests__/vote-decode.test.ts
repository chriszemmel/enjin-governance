import { describe, expect, it } from "vitest"
import {
  convictionFromByte,
  decodeCurrency,
  decodeVote,
  decodeVoteByte,
  formatCurrencyLabel,
} from "@/lib/governance/vote-decode"

describe("decodeVoteByte", () => {
  it("decodes Aye + Locked2x (130 = 0x82)", () => {
    const v = decodeVoteByte(130)
    expect(v.aye).toBe(true)
    expect(v.conviction).toBe("Locked2x")
    expect(v.multiplier).toBe(2)
    expect(v.lockPeriods).toBe(2)
  })

  it("decodes Aye + Locked1x (129 = 0x81)", () => {
    const v = decodeVoteByte(129)
    expect(v.aye).toBe(true)
    expect(v.conviction).toBe("Locked1x")
  })

  it("decodes Nay + Locked1x (1)", () => {
    const v = decodeVoteByte(1)
    expect(v.aye).toBe(false)
    expect(v.conviction).toBe("Locked1x")
  })

  it("decodes None conviction (0x80)", () => {
    const v = decodeVoteByte(0x80)
    expect(v.aye).toBe(true)
    expect(v.conviction).toBe("None")
    expect(v.multiplier).toBe(0.1)
    expect(v.lockPeriods).toBe(0)
  })

  it("decodes Aye + Locked6x (0x86)", () => {
    const v = decodeVoteByte(0x86)
    expect(v.aye).toBe(true)
    expect(v.conviction).toBe("Locked6x")
    expect(v.multiplier).toBe(6)
    expect(v.lockPeriods).toBe(32)
  })
})

describe("convictionFromByte", () => {
  it("masks the aye flag", () => {
    expect(convictionFromByte(0x82)).toBe("Locked2x")
    expect(convictionFromByte(2)).toBe("Locked2x")
  })

  it("reads only conviction bits 0-2, ignoring higher bits", () => {
    // 0x0A = aye flag clear, but bit 3 set on top of conviction 2. Only
    // bits 0-2 (= 2) count, so this is Locked2x, not a clamped Locked6x.
    expect(convictionFromByte(0x0a)).toBe("Locked2x")
    // 0x86 = aye + conviction 6.
    expect(convictionFromByte(0x86)).toBe("Locked6x")
  })
})

describe("decodeVote (loose shapes)", () => {
  it("accepts numeric string", () => {
    const v = decodeVote("130")
    expect(v?.aye).toBe(true)
    expect(v?.conviction).toBe("Locked2x")
  })

  it("accepts label-only Aye / Nay", () => {
    expect(decodeVote("Aye")?.aye).toBe(true)
    expect(decodeVote("Nay")?.aye).toBe(false)
  })

  it("accepts {aye, conviction} object", () => {
    const v = decodeVote({ aye: true, conviction: 3 })
    expect(v?.aye).toBe(true)
    expect(v?.conviction).toBe("Locked3x")
  })

  it("unwraps Standard AccountVote", () => {
    const v = decodeVote({ Standard: { vote: 0x82, balance: "100" } })
    expect(v?.aye).toBe(true)
    expect(v?.conviction).toBe("Locked2x")
  })

  it("returns null for garbage", () => {
    expect(decodeVote("not-a-vote")).toBeNull()
    expect(decodeVote(null)).toBeNull()
    expect(decodeVote(undefined)).toBeNull()
  })
})

describe("decodeCurrency", () => {
  it("recognises liquid Enj", () => {
    expect(decodeCurrency({ Enj: null }).kind).toBe("Enj")
    expect(decodeCurrency("Enj").kind).toBe("Enj")
  })

  it("extracts SEnj pool id", () => {
    const c = decodeCurrency({ SEnj: 3 })
    expect(c.kind).toBe("SEnj")
    if (c.kind !== "SEnj") return
    expect(c.poolId).toBe(3)
  })

  it("extracts SEnj pool id from the chain's struct shape", () => {
    // The runtime variant is `SEnj { tokenId: Compact<u128> }`, not
    // a flat `SEnj: <n>` - decodeCurrency has to unwrap the inner
    // `tokenId` so we don't get poolId=0 when reading on-chain votes
    // back via the chain RPC (vs Subscan's flattened display).
    const c = decodeCurrency({ SEnj: { tokenId: 34 } })
    expect(c.kind).toBe("SEnj")
    if (c.kind !== "SEnj") return
    expect(c.poolId).toBe(34)
  })

  it("extracts SEnj pool id from polkadot.js camelCase (`sEnj`)", () => {
    // polkadot.js's `.toJSON()` lowercases the first letter of enum
    // variants - `SEnj` becomes `sEnj`. That's the shape the chain
    // hook actually hands us.
    const c = decodeCurrency({ sEnj: 59 })
    expect(c.kind).toBe("SEnj")
    if (c.kind !== "SEnj") return
    expect(c.poolId).toBe(59)
  })

  it("recognises liquid Enj in polkadot.js camelCase (`enj`)", () => {
    expect(decodeCurrency({ enj: null }).kind).toBe("Enj")
  })

  it("falls back to Unknown for null", () => {
    expect(decodeCurrency(null).kind).toBe("Unknown")
  })
})

describe("formatCurrencyLabel", () => {
  it("labels ENJ + sENJ pools", () => {
    expect(formatCurrencyLabel({ kind: "Enj" })).toBe("ENJ")
    expect(formatCurrencyLabel({ kind: "SEnj", poolId: 3 })).toBe(
      "sENJ · pool #3",
    )
    expect(formatCurrencyLabel({ kind: "Unknown" })).toBe("ENJ")
  })
})

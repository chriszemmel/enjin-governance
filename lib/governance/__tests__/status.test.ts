import { describe, expect, it } from "vitest"
import { decodeReferendumInfo, decodeStatus } from "@/lib/governance/status"

/**
 * status.ts decodes polkadot.js Codec objects. These tests build minimal
 * plain-object fakes that expose exactly the properties/methods the decoder
 * reads - the same approach as lib/chain/__tests__/events.test.ts. Helpers
 * below mint the Codec-shaped primitives.
 */

// A u32/Moment-like codec: exposes toNumber().
const num = (n: number) => ({ toNumber: () => n }) as unknown
// A u128/Balance-like codec: exposes toBigInt() + toString().
const big = (b: bigint) => ({ toBigInt: () => b, toString: () => b.toString() }) as unknown
// An AccountId-like codec: exposes toString().
const acct = (s: string) => ({ toString: () => s }) as unknown
// Option<T> Some/None.
const some = (v: unknown) => ({ isSome: true, unwrap: () => v }) as unknown
const none = () => ({ isSome: false, unwrap: () => undefined }) as unknown

const tally = (ayes: bigint, nays: bigint, support: bigint) => ({
  ayes: big(ayes),
  nays: big(nays),
  support: big(support),
})

const deposit = (who: string, amount: bigint) => ({ who: acct(who), amount: big(amount) })

function ongoing(overrides: Record<string, unknown> = {}) {
  return {
    isOngoing: true,
    asOngoing: {
      track: num(2),
      origin: { foo: "bar" },
      proposal: {
        isLookup: true,
        asLookup: { toJSON: () => ({ hash: "0xabc", len: 42 }) },
      },
      enactment: { isAfter: true, asAfter: num(100) },
      submitted: num(1000),
      submissionDeposit: deposit("alice", 10n),
      decisionDeposit: some(deposit("bob", 20n)),
      deciding: some({ since: num(1100), confirming: none() }),
      tally: tally(500n, 100n, 600n),
      inQueue: { valueOf: () => false },
      alarm: some([num(2000), []]),
      ...overrides,
    },
  } as unknown
}

describe("decodeStatus - Ongoing", () => {
  it("decodes the full ongoing shape", () => {
    const s = decodeStatus(ongoing())
    expect(s.type).toBe("Ongoing")
    if (s.type !== "Ongoing") throw new Error("unreachable")
    expect(s.trackId).toBe(2)
    expect(s.submitted).toBe(1000)
    expect(s.tally).toEqual({ ayes: 500n, nays: 100n, support: 600n })
    expect(s.submissionDeposit).toEqual({ who: "alice", amount: 10n })
    expect(s.decisionDeposit).toEqual({ who: "bob", amount: 20n })
    expect(s.deciding).toEqual({ since: 1100, confirming: null })
    expect(s.enactment).toEqual({ type: "After", block: 100 })
    expect(s.alarm).toEqual({ when: 2000 })
    expect(s.inQueue).toBe(false)
  })

  it("reads the Lookup proposal hash/len via toJSON (Enjin runtime quirk)", () => {
    const s = decodeStatus(ongoing())
    if (s.type !== "Ongoing") throw new Error("unreachable")
    expect(s.proposal).toEqual({ hash: "0xabc", len: 42 })
  })

  it("decodes a confirming deciding window", () => {
    const s = decodeStatus(
      ongoing({ deciding: some({ since: num(1100), confirming: some(num(1300)) }) }),
    )
    if (s.type !== "Ongoing") throw new Error("unreachable")
    expect(s.deciding).toEqual({ since: 1100, confirming: 1300 })
  })

  it("treats a None decisionDeposit as null", () => {
    const s = decodeStatus(ongoing({ decisionDeposit: none() }))
    if (s.type !== "Ongoing") throw new Error("unreachable")
    expect(s.decisionDeposit).toBeNull()
  })

  it("decodes an Inline proposal to its bare call bytes (no length prefix)", () => {
    const bytes = new Uint8Array([1, 2, 3])
    // A BoundedVec's plain toU8a() carries a compact length prefix (3 << 2).
    const prefixed = new Uint8Array([12, 1, 2, 3])
    const s = decodeStatus(
      ongoing({
        proposal: {
          isInline: true,
          asInline: { toU8a: (isBare?: boolean) => (isBare ? bytes : prefixed) },
        },
      }),
    )
    if (s.type !== "Ongoing") throw new Error("unreachable")
    expect(s.proposal).toEqual({ type: "Inline", bytes })
  })

  it("decodes a Legacy proposal (len forced to 0)", () => {
    const s = decodeStatus(
      ongoing({ proposal: { isLegacy: true, asLegacy: { toJSON: () => ({ hash: "0xdef" }) } } }),
    )
    if (s.type !== "Ongoing") throw new Error("unreachable")
    expect(s.proposal).toEqual({ hash: "0xdef", len: 0 })
  })

  it("decodes At-enactment", () => {
    const s = decodeStatus(ongoing({ enactment: { isAt: true, asAt: num(777) } }))
    if (s.type !== "Ongoing") throw new Error("unreachable")
    expect(s.enactment).toEqual({ type: "At", block: 777 })
  })
})

describe("decodeStatus - terminal variants", () => {
  const cases = [
    ["Approved", "isApproved", "asApproved"],
    ["Rejected", "isRejected", "asRejected"],
    ["Cancelled", "isCancelled", "asCancelled"],
    ["TimedOut", "isTimedOut", "asTimedOut"],
  ] as const

  for (const [type, isKey, asKey] of cases) {
    it(`decodes ${type} from an array tuple (block, sub, dec)`, () => {
      const raw = {
        [isKey]: true,
        [asKey]: [num(9000), some(deposit("alice", 10n)), none()],
      } as unknown
      const s = decodeStatus(raw)
      expect(s.type).toBe(type)
      if (s.type === "Ongoing" || s.type === "Killed") throw new Error("unreachable")
      expect(s.at).toBe(9000)
      expect(s.submissionDeposit).toEqual({ who: "alice", amount: 10n })
      expect(s.decisionDeposit).toBeNull()
    })
  }

  it("decodes a terminal variant exposed via toJSON tuple", () => {
    const raw = {
      isApproved: true,
      asApproved: { toJSON: () => [9100, null, null] },
    } as unknown
    const s = decodeStatus(raw)
    expect(s.type).toBe("Approved")
    if (s.type !== "Approved") throw new Error("unreachable")
    expect(s.at).toBe(9100)
    expect(s.submissionDeposit).toBeNull()
    expect(s.decisionDeposit).toBeNull()
  })
})

describe("decodeStatus - Killed", () => {
  it("decodes a single-value Killed", () => {
    const s = decodeStatus({ isKilled: true, asKilled: num(8000) } as unknown)
    expect(s).toEqual({ type: "Killed", at: 8000 })
  })

  it("decodes a tuple-shaped Killed", () => {
    const s = decodeStatus({ isKilled: true, asKilled: { 0: num(8100) } } as unknown)
    expect(s).toEqual({ type: "Killed", at: 8100 })
  })
})

describe("decodeStatus - unknown", () => {
  it("throws on an unrecognised variant", () => {
    expect(() => decodeStatus({} as unknown)).toThrow(/Unknown referendum status variant/)
  })
})

describe("decodeReferendumInfo", () => {
  it("returns null for a None storage entry", () => {
    expect(decodeReferendumInfo(5, none())).toBeNull()
  })

  it("unwraps a Some(ReferendumInfo) and carries trackId + tally for Ongoing", () => {
    const ref = decodeReferendumInfo(5, some(ongoing()))
    expect(ref).not.toBeNull()
    expect(ref!.index).toBe(5)
    expect(ref!.status.type).toBe("Ongoing")
    expect(ref!.trackId).toBe(2)
    expect(ref!.tally).toEqual({ ayes: 500n, nays: 100n, support: 600n })
  })

  it("accepts an already-unwrapped info object", () => {
    const ref = decodeReferendumInfo(6, ongoing())
    expect(ref!.index).toBe(6)
    expect(ref!.status.type).toBe("Ongoing")
  })

  it("null trackId + tally for terminal referenda", () => {
    const raw = some({ isApproved: true, asApproved: [num(9000), none(), none()] })
    const ref = decodeReferendumInfo(7, raw)
    expect(ref!.status.type).toBe("Approved")
    expect(ref!.trackId).toBeNull()
    expect(ref!.tally).toBeNull()
  })
})

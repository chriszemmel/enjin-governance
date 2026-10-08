import { beforeAll, describe, expect, it } from "vitest"
import { initializeWasm } from "@/lib/chain/ss58"
import {
  localSpendTarget,
  nextSpendPeriodBlock,
  resolvePayout,
  type SpendTarget,
  type TreasuryProposalEntry,
} from "@/lib/governance/payout"
import type { EnactmentRecord } from "@/lib/governance/scheduler"

beforeAll(async () => {
  await initializeWasm()
})

// Mainnet referendum #12: spend_local 30,000 ENJ to this beneficiary,
// SpendApproved proposal #6 at 17,547,682, awarded at 17,553,600.
const BENEFICIARY = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const PUBKEY = "0x603cdcc015e3ebc86fbd1e371bb74b7682677481d40663f953303cf61c88f509" as const
const AMOUNT = 30_000n * 10n ** 18n
const spend: SpendTarget = { beneficiary: PUBKEY, amount: AMOUNT }

const proposal6: TreasuryProposalEntry = { index: 6, beneficiary: PUBKEY, value: AMOUNT }
const record: EnactmentRecord = {
  block: 17_547_682,
  ok: true,
  spends: [{ proposalIndex: 6, amount: AMOUNT, beneficiary: PUBKEY }],
}

describe("nextSpendPeriodBlock", () => {
  it("is the next multiple of spendPeriod after the block", () => {
    expect(nextSpendPeriodBlock(17_547_682, 14_400)).toBe(17_553_600)
  })

  it("a spend period that has just run is not the next one", () => {
    expect(nextSpendPeriodBlock(17_553_600, 14_400)).toBe(17_568_000)
  })
})

describe("localSpendTarget", () => {
  it("keys a spend_local by beneficiary public key and amount", () => {
    expect(
      localSpendTarget({
        kind: "treasury-spend",
        method: "spendLocal",
        amount: AMOUNT,
        beneficiary: BENEFICIARY,
      }),
    ).toEqual(spend)
  })

  it("ignores treasury.spend (paid through treasury.payout) and other calls", () => {
    expect(
      localSpendTarget({
        kind: "treasury-spend",
        method: "spend",
        amount: AMOUNT,
        beneficiary: BENEFICIARY,
      }),
    ).toBeNull()
    expect(localSpendTarget({ kind: "generic", section: "system", method: "remark" })).toBeNull()
    expect(localSpendTarget(null)).toBeNull()
  })
})

describe("resolvePayout", () => {
  it("with the record: pending while proposal #6 is stored and approved", () => {
    expect(resolvePayout({ record, spend, proposals: [proposal6], approvals: [6] })).toEqual({
      status: "pending",
      proposalIndex: 6,
    })
  })

  it("with the record: paid once proposal #6 is gone", () => {
    expect(resolvePayout({ record, spend, proposals: [], approvals: [] })).toEqual({
      status: "paid",
      proposalIndex: 6,
    })
  })

  it("a failed dispatch: nothing to pay", () => {
    expect(
      resolvePayout({
        record: { ...record, ok: false, spends: [] },
        spend,
        proposals: [],
        approvals: [],
      }),
    ).toEqual({ status: "none" })
  })

  it("stored but no longer approved: unknown", () => {
    expect(resolvePayout({ record, spend, proposals: [proposal6], approvals: [] })).toEqual({
      status: "unknown",
    })
  })

  it("without the record: a matching approved proposal is pending", () => {
    expect(
      resolvePayout({
        record: null,
        spend,
        proposals: [{ index: 5, beneficiary: PUBKEY, value: 1n }, proposal6],
        approvals: [5, 6],
      }),
    ).toEqual({ status: "pending", proposalIndex: 6 })
  })

  it("without the record: no matching proposal is unknown, never paid", () => {
    expect(resolvePayout({ record: null, spend, proposals: [], approvals: [] })).toEqual({
      status: "unknown",
    })
  })

  it("without the record: two identical spends waiting are pending, index unknown", () => {
    const twin = { ...proposal6, index: 7 }
    expect(
      resolvePayout({ record: null, spend, proposals: [proposal6, twin], approvals: [6, 7] }),
    ).toEqual({ status: "pending", proposalIndex: null })
  })
})

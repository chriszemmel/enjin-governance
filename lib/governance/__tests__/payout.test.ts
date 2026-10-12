import { beforeAll, describe, expect, it } from "vitest"
import { initializeWasm } from "@/lib/chain/ss58"
import {
  findAwardBlock,
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

describe("findAwardBlock", () => {
  const SP = 14_400
  // #12's proposal #6: enacted at 17,547,682, awarded at 17,553,600.
  const ENACTED = 17_547_682
  const AWARD = 17_553_600
  /** A proposal stored until `paidAt`, awarded there; counts the reads. */
  function chain(paidAt: number | null) {
    const reads: number[] = []
    return {
      reads,
      stored: async (block: number) => {
        reads.push(block)
        return paidAt == null || block < paidAt
      },
      awarded: async (block: number) => block === paidAt,
    }
  }

  it("the first spend period after enactment", async () => {
    const c = chain(AWARD)
    await expect(
      findAwardBlock({ enactedAt: ENACTED, currentBlock: 17_600_000, spendPeriod: SP, ...c }),
    ).resolves.toBe(AWARD)
  })

  it("a later period when the pot couldn't cover the first, in a few reads", async () => {
    const later = AWARD + 30 * SP
    const c = chain(later)
    await expect(
      findAwardBlock({ enactedAt: ENACTED, currentBlock: later + 90 * SP, spendPeriod: SP, ...c }),
    ).resolves.toBe(later)
    expect(c.reads.length).toBeLessThanOrEqual(8)
  })

  it("an enactment on a spend period block waits for the next one", async () => {
    const c = chain(AWARD + SP)
    await expect(
      findAwardBlock({ enactedAt: AWARD, currentBlock: AWARD + 2 * SP, spendPeriod: SP, ...c }),
    ).resolves.toBe(AWARD + SP)
  })

  it("still stored at the last period: not found", async () => {
    await expect(
      findAwardBlock({
        enactedAt: ENACTED,
        currentBlock: 17_600_000,
        spendPeriod: SP,
        ...chain(null),
      }),
    ).resolves.toBeNull()
  })

  it("no spend period since enactment: not found, nothing read", async () => {
    const c = chain(AWARD)
    await expect(
      findAwardBlock({ enactedAt: ENACTED, currentBlock: AWARD - 1, spendPeriod: SP, ...c }),
    ).resolves.toBeNull()
    expect(c.reads).toEqual([])
  })

  it("gone without an Awarded event there: not dated", async () => {
    const c = { ...chain(AWARD), awarded: async () => false }
    await expect(
      findAwardBlock({ enactedAt: ENACTED, currentBlock: 17_600_000, spendPeriod: SP, ...c }),
    ).resolves.toBeNull()
  })
})

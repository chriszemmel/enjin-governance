/**
 * The payout of a `treasury.spend`, which nobody pays automatically: it is
 * claimed by calling `treasury.payout` within a window. Values are the
 * Chopsticks fork of Enjin Relay mainnet (spec 1082): spend #0 approved at
 * 18,289,970 for 250,000 ENJ, valid until 18,721,970 (432,000 blocks later,
 * `treasury.payoutPeriod`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import {
  buildClaimPayout,
  claimSpendTarget,
  readTreasurySpends,
  resolveClaim,
  type TreasurySpendEntry,
} from "@/lib/governance/payout"
import type { ProposalIntent } from "@/lib/governance/call-extract"
import { enactmentOutcome, type SchedulerEvent } from "@/lib/governance/scheduler"
import { getLifecycle } from "@/lib/governance/lifecycle"
import { finishedSummary, heroFor, stepRows } from "@/lib/governance/lifecycle-view"
import type { OngoingStatus, Referendum, TerminalStatus, Track } from "@/lib/governance/types"
import type { EnactmentRecord } from "@/lib/governance/scheduler"

const ENJ = 10n ** 18n
const BENEFICIARY = "enAvhEMRnmzEJHSpJHBCQAh4AXNSeGjLFJEokqWybDvYnHfim"
const PUBKEY = `0x${"ab".repeat(32)}` as const
const AMOUNT = 200_000n * ENJ
const spend = { beneficiary: PUBKEY, amount: AMOUNT }

const VALID_FROM = 18_289_970
const EXPIRE_AT = 18_721_970

const entry = (over: Partial<TreasurySpendEntry> = {}): TreasurySpendEntry => ({
  index: 0,
  beneficiary: PUBKEY,
  amount: AMOUNT,
  validFrom: VALID_FROM,
  expireAt: EXPIRE_AT,
  status: "pending",
  ...over,
})
const record = (over: Partial<EnactmentRecord> = {}): EnactmentRecord => ({
  block: VALID_FROM,
  ok: true,
  spends: [
    {
      proposalIndex: 0,
      amount: AMOUNT,
      beneficiary: PUBKEY,
      validFrom: VALID_FROM,
      expireAt: EXPIRE_AT,
    },
  ],
  ...over,
})

describe("claimSpendTarget", () => {
  const intent = (method: string, beneficiary = BENEFICIARY) =>
    ({ kind: "treasury-spend", method, beneficiary, amount: AMOUNT }) as unknown as ProposalIntent

  it("is the spend a treasury.spend makes, and nothing for spend_local", () => {
    expect(claimSpendTarget(intent("spend"))?.amount).toBe(AMOUNT)
    expect(claimSpendTarget(intent("spend"))?.beneficiary).toMatch(/^0x[0-9a-f]{64}$/)
    expect(claimSpendTarget(intent("spend_local"))).toBeNull()
    expect(claimSpendTarget(intent("spendLocal"))).toBeNull()
  })

  it("is nothing for another call, an unparseable beneficiary or no intent", () => {
    expect(claimSpendTarget({ kind: "generic", section: "system", method: "remark" })).toBeNull()
    expect(claimSpendTarget(intent("spend", "not an address"))).toBeNull()
    expect(claimSpendTarget(undefined)).toBeNull()
  })
})

describe("resolveClaim", () => {
  const resolve = (over: Parameters<typeof resolveClaim>[0]) => resolveClaim(over)

  it("open: the spend the enactment announced, within its window", () => {
    expect(
      resolve({ record: record(), spend, spends: [entry()], currentBlock: VALID_FROM + 10 }),
    ).toEqual({ status: "open", spendIndex: 0, expireAt: EXPIRE_AT })
  })

  it("open on the last block of the window", () => {
    expect(
      resolve({ record: record(), spend, spends: [entry()], currentBlock: EXPIRE_AT }).status,
    ).toBe("open")
  })

  it("expired once the window has passed without a payout", () => {
    expect(
      resolve({ record: record(), spend, spends: [entry()], currentBlock: EXPIRE_AT + 1 }),
    ).toEqual({ status: "expired", spendIndex: 0, expireAt: EXPIRE_AT })
  })

  it("paid once the payout has been attempted (until checkStatus clears the entry)", () => {
    expect(
      resolve({
        record: record(),
        spend,
        spends: [entry({ status: "attempted" })],
        currentBlock: VALID_FROM + 10,
      }),
    ).toEqual({ status: "paid", spendIndex: 0 })
  })

  it("a failed payment can be claimed again, until it expires", () => {
    expect(
      resolve({
        record: record(),
        spend,
        spends: [entry({ status: "failed" })],
        currentBlock: VALID_FROM + 10,
      }).status,
    ).toBe("open")
  })

  it("uses the index the enactment announced, not another spend of the same amount", () => {
    const spends = [entry({ index: 3 }), entry({ index: 0 })]
    expect(
      resolve({ record: record(), spend, spends, currentBlock: VALID_FROM + 10 }),
    ).toMatchObject({ status: "open", spendIndex: 0 })
  })

  it("without the archive record, takes the latest pending spend with the same beneficiary and amount", () => {
    const spends = [entry({ index: 3 }), entry({ index: 5 }), entry({ index: 6, amount: 1n })]
    expect(resolve({ record: null, spend, spends, currentBlock: VALID_FROM + 10 })).toMatchObject({
      status: "open",
      spendIndex: 5,
    })
  })

  it("without the record and without such a spend, it can't be told", () => {
    expect(resolve({ record: null, spend, spends: [], currentBlock: VALID_FROM + 10 })).toEqual({
      status: "unknown",
    })
    expect(
      resolve({
        record: null,
        spend,
        spends: [entry({ status: "attempted" })],
        currentBlock: VALID_FROM + 10,
      }).status,
    ).toBe("unknown")
  })

  it("a spend that is gone is paid while its window lasts, and closed after", () => {
    expect(
      resolve({ record: record(), spend, spends: [], currentBlock: VALID_FROM + 100 }),
    ).toEqual({ status: "paid", spendIndex: 0 })
    expect(resolve({ record: record(), spend, spends: [], currentBlock: EXPIRE_AT + 1 })).toEqual({
      status: "closed",
      spendIndex: 0,
    })
  })

  it("a failed enactment leaves nothing to claim", () => {
    expect(
      resolve({
        record: record({ ok: false, spends: [] }),
        spend,
        spends: [entry()],
        currentBlock: VALID_FROM + 10,
      }),
    ).toEqual({ status: "none" })
  })

  it("an unknown head still says open (it can't tell expired without it)", () => {
    expect(resolve({ record: record(), spend, spends: [entry()], currentBlock: null }).status).toBe(
      "open",
    )
  })

  it("a spend_local proposal in the record is not taken for the spend", () => {
    const local = record({
      spends: [{ proposalIndex: 9, amount: AMOUNT, beneficiary: PUBKEY }],
    })
    expect(resolve({ record: local, spend, spends: [], currentBlock: VALID_FROM }).status).toBe(
      "unknown",
    )
  })
})

describe("buildClaimPayout", () => {
  it("is treasury.payout(index)", () => {
    const payout = vi.fn((index: number) => ({ method: "payout", index }))
    const api = { tx: { treasury: { payout } } } as unknown as Pick<ApiPromise, "tx">
    expect(buildClaimPayout(api, 4)).toEqual({ method: "payout", index: 4 })
    expect(payout).toHaveBeenCalledWith(4)
  })

  it("names the call when the chain has none", () => {
    const api = { tx: { treasury: {} } } as unknown as Pick<ApiPromise, "tx">
    expect(() => buildClaimPayout(api, 4)).toThrow(/treasury\.payout/)
  })
})

describe("readTreasurySpends", () => {
  const num = (n: number) => ({ toNumber: () => n })
  const raw = (status: "isPending" | "isAttempted" | "isFailed") => ({
    amount: { toBigInt: () => AMOUNT },
    beneficiary: { toU8a: () => new Uint8Array(32).fill(0xab) },
    validFrom: num(VALID_FROM),
    expireAt: num(EXPIRE_AT),
    status: { [status]: true },
  })
  const apiWith = (entries: Array<[number, unknown]>) =>
    ({
      query: {
        treasury: {
          spends: { entries: async () => entries.map(([i, v]) => [{ args: [num(i)] }, v]) },
        },
      },
    }) as unknown as ApiPromise

  it("reads Some and unwrapped entries with their status, and skips None", async () => {
    const api = apiWith([
      [0, { isSome: true, unwrap: () => raw("isPending") }],
      [1, raw("isAttempted")],
      [2, { isSome: false, unwrap: () => null }],
      [3, raw("isFailed")],
    ])
    expect(await readTreasurySpends(api)).toEqual([
      entry({ index: 0, status: "pending" }),
      entry({ index: 1, status: "attempted" }),
      entry({ index: 3, status: "failed" }),
    ])
  })

  it("is empty on a chain without treasury.spends", async () => {
    expect(await readTreasurySpends({ query: {} } as unknown as ApiPromise)).toEqual([])
  })
})

describe("enactmentOutcome with AssetSpendApproved", () => {
  const TASK = "0xabc"
  it("carries the spend's window next to its index", () => {
    const events: SchedulerEvent[] = [
      {
        kind: "spendApproved",
        proposalIndex: 0,
        amount: AMOUNT,
        beneficiary: PUBKEY,
        validFrom: VALID_FROM,
        expireAt: EXPIRE_AT,
      },
      { kind: "dispatched", taskName: TASK, ok: true },
    ]
    expect(enactmentOutcome(events, TASK)).toEqual({
      ok: true,
      spends: [
        {
          proposalIndex: 0,
          amount: AMOUNT,
          beneficiary: PUBKEY,
          validFrom: VALID_FROM,
          expireAt: EXPIRE_AT,
        },
      ],
    })
  })
})

// ---------------------------------------------------------------- the card

const HEAD = 18_300_000
const NOW = new Date("2026-11-25T18:00:00Z")
const curve = { type: "LinearDecreasing", length: 1, floor: 0, ceil: 0 } as const
const mediumSpender: Track = {
  id: 203,
  name: "medium_spender",
  maxDeciding: 50,
  decisionDeposit: 1n,
  preparePeriod: 2_400,
  decisionPeriod: 201_600,
  confirmPeriod: 14_400,
  minEnactmentPeriod: 14_400,
  minApproval: curve,
  minSupport: curve,
}
const approved20 = (): Referendum => {
  const status: TerminalStatus = {
    type: "Approved",
    at: 18_275_000,
    submissionDeposit: { who: "x", amount: 0n },
    decisionDeposit: null,
  }
  return { index: 20, status, trackId: null, tally: null }
}
const ongoing20 = (): Referendum => {
  const status: OngoingStatus = {
    type: "Ongoing",
    trackId: 203,
    origin: {},
    proposal: { hash: "0x" as `0x${string}`, len: 46 },
    enactment: { type: "After", block: 0 },
    submitted: 18_107_625,
    submissionDeposit: { who: "x", amount: 0n },
    decisionDeposit: { who: "x", amount: 1n },
    deciding: { since: 18_110_025, confirming: null },
    tally: { ayes: 0n, nays: 0n, support: 0n },
    inQueue: false,
    alarm: null,
  }
  return { index: 20, status, trackId: 203, tally: status.tally }
}
const executed = { status: "executed", block: VALID_FROM, ok: true } as const

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the lifecycle of a treasury.spend", () => {
  it("while voting: the payout is pending, with no date", () => {
    const lc = getLifecycle(ongoing20(), mediumSpender, HEAD, {
      spend: { claim: { status: "unknown" } },
    })
    expect(lc.payout).toMatchObject({ state: "upcoming", claim: true, block: null })
    expect(stepRows(lc, HEAD, "200,000 ENJ").at(-1)).toMatchObject({
      key: "payout",
      label: "Payout · 200,000 ENJ",
      note: "You claim it yourself once the call has run.",
      state: "upcoming",
      dashed: true,
      when: { main: "Pending" },
    })
    expect(stepRows(lc, HEAD, "200,000 ENJ").at(-1)?.action).toBeUndefined()
  })

  it("once enacted: open, with the button, until the window ends", () => {
    const lc = getLifecycle(approved20(), mediumSpender, HEAD, {
      enactment: executed,
      spend: { claim: { status: "open", spendIndex: 0, expireAt: EXPIRE_AT } },
    })
    expect(lc.payout).toMatchObject({ state: "claimable", claim: true, spendIndex: 0 })
    const row = stepRows(lc, HEAD, "200,000 ENJ").at(-1)
    expect(row).toMatchObject({
      key: "payout",
      label: "Payout · 200,000 ENJ",
      state: "active",
      when: { main: "Open" },
      action: { kind: "claim", spendIndex: 0 },
    })
    expect(row?.note).toMatch(
      /^Expires ≈ \w{3} \d+, \d{4}\. Anyone can trigger this, the beneficiary receives it\.$|^Expires ≈ \w{3} \d+\. Anyone can trigger this, the beneficiary receives it\.$/,
    )
    expect(row?.action?.expires).toMatch(/^≈ /)
    expect(heroFor(lc, HEAD)).toMatchObject({ unit: "left to claim", approved: true })
  })

  it("paid: done, and the summary says so", () => {
    const lc = getLifecycle(approved20(), mediumSpender, HEAD, {
      enactment: executed,
      spend: { claim: { status: "paid", spendIndex: 0 } },
    })
    expect(stepRows(lc, HEAD, "200,000 ENJ").at(-1)).toMatchObject({
      label: "Paid out · 200,000 ENJ",
      state: "done",
      when: { main: "Paid" },
    })
    expect(finishedSummary(lc, HEAD, 18_275_000, "200,000 ENJ")).toMatchObject({
      title: "Paid out 200,000 ENJ",
      tone: "ok",
    })
  })

  it("expired: failed, red, and the funds stay in the treasury", () => {
    const head = EXPIRE_AT + 5
    const lc = getLifecycle(approved20(), mediumSpender, head, {
      enactment: executed,
      spend: { claim: { status: "expired", spendIndex: 0, expireAt: EXPIRE_AT } },
    })
    const row = stepRows(lc, head, "200,000 ENJ").at(-1)
    expect(row).toMatchObject({ state: "failed", when: { main: "Expired" } })
    expect(row?.note).toContain("The funds stay in the treasury.")
    expect(row?.action).toBeUndefined()
    expect(finishedSummary(lc, head, 18_275_000, "200,000 ENJ")).toMatchObject({
      sub: "Not claimed in time. The funds stay in the treasury.",
      tone: "danger",
    })
  })

  it("closed: neither claimed nor open any more", () => {
    const lc = getLifecycle(approved20(), mediumSpender, HEAD, {
      enactment: executed,
      spend: { claim: { status: "closed", spendIndex: 0 } },
    })
    expect(stepRows(lc, HEAD, null).at(-1)).toMatchObject({
      label: "Payout",
      state: "unknown",
      when: { main: "Closed" },
    })
    expect(finishedSummary(lc, HEAD, 18_275_000, null).tone).toBe("muted")
  })

  it("a failed enactment: no payout", () => {
    const lc = getLifecycle(approved20(), mediumSpender, HEAD, {
      enactment: { status: "executed", block: VALID_FROM, ok: false },
      spend: { claim: { status: "none" } },
    })
    expect(stepRows(lc, HEAD, null).at(-1)).toMatchObject({ label: "No payout", state: "skipped" })
  })

  it("not enacted yet, or not read: pending, then unknown", () => {
    const scheduled = getLifecycle(approved20(), mediumSpender, HEAD, {
      enactment: { status: "scheduled", block: HEAD + 100 },
      spend: { claim: { status: "unknown" } },
    })
    expect(scheduled.payout).toMatchObject({ state: "upcoming", claim: true })
    const unread = getLifecycle(approved20(), mediumSpender, HEAD, {
      enactment: executed,
      spend: { claim: { status: "unknown" } },
    })
    expect(unread.payout).toMatchObject({ state: "unknown", claim: true })
    expect(stepRows(unread, HEAD, null).at(-1)).toMatchObject({
      state: "unknown",
      when: { main: "Pending" },
    })
  })

  it("an open spend without its index offers no button", () => {
    const lc = getLifecycle(approved20(), mediumSpender, HEAD, {
      enactment: executed,
      spend: { claim: { status: "open", spendIndex: 0, expireAt: EXPIRE_AT } },
    })
    const payout = { ...lc.payout!, spendIndex: null }
    const rows = stepRows({ ...lc, payout }, HEAD, null)
    expect(rows.at(-1)?.action).toBeUndefined()
  })
})

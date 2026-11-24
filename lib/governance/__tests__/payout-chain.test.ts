import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import {
  awardReaders,
  findAwardBlock,
  localSpendTarget,
  nextSpendPeriodBlock,
  readTreasuryProposals,
} from "@/lib/governance/payout"
import type { ProposalIntent } from "@/lib/governance/call-extract"

/**
 * The archive readers behind the payout line (treasury proposals, award
 * blocks) and the guards payout.test.ts leaves out. Mainnet referendum
 * #12's numbers: proposal #6, 30,000 ENJ, awarded at 17,553,600.
 */

const asApi = (fake: object) => fake as unknown as ApiPromise
const num = (n: number) => ({ toNumber: () => n })
const PUBKEY = new Uint8Array(32).fill(0x60)
const PUBKEY_HEX = `0x${"60".repeat(32)}`
const AMOUNT = 30_000n * 10n ** 18n

describe("guards", () => {
  it("a non-positive spend period never schedules or dates anything", async () => {
    expect(nextSpendPeriodBlock(100, 0)).toBe(101)
    const neverRead = async () => {
      throw new Error("must not read the chain")
    }
    expect(
      await findAwardBlock({
        enactedAt: 1,
        currentBlock: 1_000_000,
        spendPeriod: 0,
        stored: neverRead,
        awarded: neverRead,
      }),
    ).toBeNull()
  })

  it("an unparseable beneficiary gives no spend target", () => {
    const intent = {
      kind: "treasury-spend",
      method: "spend_local",
      beneficiary: "not an address",
      amount: 1n,
    } as unknown as ProposalIntent
    expect(localSpendTarget(intent)).toBeNull()
    expect(localSpendTarget(undefined)).toBeNull()
  })
})

describe("readTreasuryProposals", () => {
  function treasuryApi(entries: Array<[number, unknown]>, approvals: number[]) {
    return asApi({
      query: {
        treasury: {
          proposals: {
            entries: async () => entries.map(([i, v]) => [{ args: [num(i)] }, v]),
          },
          approvals: async () => approvals.map(num),
        },
      },
    })
  }
  const proposal = (amount: bigint) => ({
    beneficiary: { toU8a: () => PUBKEY },
    value: { toBigInt: () => amount },
  })

  it("reads Some and unwrapped proposals, skips None, and lists approvals", async () => {
    const api = treasuryApi(
      [
        [6, { isSome: true, unwrap: () => proposal(AMOUNT) }],
        [7, proposal(5n)],
        [8, { isSome: false, unwrap: () => null }],
      ],
      [6, 7],
    )
    expect(await readTreasuryProposals(api)).toEqual({
      proposals: [
        { index: 6, beneficiary: PUBKEY_HEX, value: AMOUNT },
        { index: 7, beneficiary: PUBKEY_HEX, value: 5n },
      ],
      approvals: [6, 7],
    })
  })

  it("refuses a chain without a treasury", async () => {
    await expect(readTreasuryProposals(asApi({ query: {} }))).rejects.toThrow(/treasury\.proposals/)
  })
})

describe("awardReaders", () => {
  const AWARD = 17_553_600

  function archive(opts: { storedUntil: number; events: (block: number) => unknown[] }) {
    return asApi({
      rpc: { chain: { getBlockHash: async (block: number) => block } },
      at: async (block: number) => ({
        query: {
          treasury: {
            proposals: async (index: number) => ({
              isSome: index === 6 && block < opts.storedUntil,
            }),
          },
          system: { events: async () => opts.events(block) },
        },
      }),
    })
  }
  const awarded = (data: unknown) => ({
    event: { section: "treasury", method: "Awarded", data: { toJSON: () => data } },
  })

  it("tells whether the proposal is stored after a block", async () => {
    const { stored } = awardReaders(archive({ storedUntil: AWARD, events: () => [] }), 6)
    expect(await stored(AWARD - 14_400)).toBe(true)
    expect(await stored(AWARD)).toBe(false)
  })

  it("finds the Awarded event for the proposal, as array or named data", async () => {
    const events = (block: number) =>
      block === AWARD
        ? [
            { event: { section: "balances", method: "Transfer", data: { toJSON: () => [] } } },
            awarded([5, "1", PUBKEY_HEX]),
            awarded({ proposalIndex: 6, award: "1", account: PUBKEY_HEX }),
          ]
        : [awarded([9, "1", PUBKEY_HEX])] // another proposal's award
    const readers = awardReaders(archive({ storedUntil: AWARD, events }), 6)
    expect(await readers.awarded(AWARD)).toBe(true)
    expect(await readers.awarded(AWARD - 14_400)).toBe(false)
  })

  it("dates the award end to end with findAwardBlock", async () => {
    const readers = awardReaders(
      archive({
        storedUntil: AWARD,
        events: (block) => (block === AWARD ? [awarded([6, "1", PUBKEY_HEX])] : []),
      }),
      6,
    )
    expect(
      await findAwardBlock({
        enactedAt: 17_547_682,
        currentBlock: AWARD + 100_000,
        spendPeriod: 14_400,
        ...readers,
      }),
    ).toBe(AWARD)
  })
})

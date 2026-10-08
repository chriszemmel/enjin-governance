import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import {
  convictionLockBlocks,
  DEFAULT_VOTE_LOCKING_PERIOD,
  getVoteLockingPeriod,
} from "@/lib/governance/conviction-voting"

/**
 * Conviction locks are measured in the runtime's
 * `convictionVoting.voteLockingPeriod` (100,800 blocks on Enjin mainnet and
 * canary), not in the track's decision period (201,600 blocks on most Enjin
 * tracks, 43,200 on whitelisted_caller) - the UI used to multiply by the
 * latter, doubling most displayed lock times.
 */

const u32 = (n: number) => ({ toNumber: () => n })

function apiWithConsts(consts: Record<string, Record<string, unknown>>): ApiPromise {
  return { consts } as unknown as ApiPromise
}

describe("getVoteLockingPeriod", () => {
  it("reads convictionVoting.voteLockingPeriod from the runtime", () => {
    const api = apiWithConsts({ convictionVoting: { voteLockingPeriod: u32(50_400) } })
    expect(getVoteLockingPeriod(api)).toBe(50_400)
  })

  it("falls back to a voteManager constant when convictionVoting has none", () => {
    const api = apiWithConsts({ voteManager: { voteLockingPeriod: u32(72_000) } })
    expect(getVoteLockingPeriod(api)).toBe(72_000)
  })

  it("uses Enjin's value while the api isn't ready", () => {
    expect(DEFAULT_VOTE_LOCKING_PERIOD).toBe(100_800)
    expect(getVoteLockingPeriod(undefined)).toBe(DEFAULT_VOTE_LOCKING_PERIOD)
    expect(getVoteLockingPeriod(null)).toBe(DEFAULT_VOTE_LOCKING_PERIOD)
  })

  it("uses Enjin's value when the runtime has no usable constant", () => {
    expect(getVoteLockingPeriod(apiWithConsts({}))).toBe(DEFAULT_VOTE_LOCKING_PERIOD)
    const zero = apiWithConsts({ convictionVoting: { voteLockingPeriod: u32(0) } })
    expect(getVoteLockingPeriod(zero)).toBe(DEFAULT_VOTE_LOCKING_PERIOD)
  })
})

describe("convictionLockBlocks", () => {
  it("is lock periods × voteLockingPeriod", () => {
    expect(convictionLockBlocks("None", 100_800)).toBe(0)
    expect(convictionLockBlocks("Locked1x", 100_800)).toBe(100_800)
    expect(convictionLockBlocks("Locked3x", 100_800)).toBe(403_200)
    expect(convictionLockBlocks("Locked6x", 100_800)).toBe(32 * 100_800)
  })

  it("matches the unlock blocks Enjin mainnet set after referendum #9", () => {
    // #9 (medium_spender, decision period 201,600) was approved at block
    // 16,408,035. Removing its Locked3x and Locked2x aye votes left prior
    // locks expiring at 16,811,235 and 16,609,635 - end + 4 and + 2
    // voteLockingPeriods. The decision-period formula would have said
    // 17,214,435 and 16,811,235.
    const end = 16_408_035
    expect(end + convictionLockBlocks("Locked3x", 100_800)).toBe(16_811_235)
    expect(end + convictionLockBlocks("Locked2x", 100_800)).toBe(16_609_635)
  })
})

import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import {
  DESTROYING_POOL_VOTING_ENDS_SPEC,
  getStakedEnjBalances,
  senjCanVote,
} from "@/lib/governance/staking-pools"

describe("senjCanVote", () => {
  it("blocks sENJ of a Destroying pool from spec 1080", () => {
    expect(DESTROYING_POOL_VOTING_ENDS_SPEC).toBe(1080)
    expect(senjCanVote("Destroying", 1080)).toBe(false)
    expect(senjCanVote("Destroying", 1090)).toBe(false)
  })

  it("still lets it vote on 1070", () => {
    expect(senjCanVote("Destroying", 1070)).toBe(true)
  })

  it("never blocks an open pool, or one whose state is unknown", () => {
    expect(senjCanVote("Open", 1080)).toBe(true)
    expect(senjCanVote(null, 1080)).toBe(true)
  })
})

/** Two pools the account holds sENJ in: #1 open, #2 being destroyed. */
function fakeApi(): ApiPromise {
  const pools: Record<number, unknown> = {
    1: { state: "Open", tokenId: 11, name: "0x4f6e65" },
    2: { state: "Destroying", tokenId: 12, name: null },
  }
  const json = (v: unknown) => ({ toJSON: () => v })
  const bondedPools = Object.assign(async (id: number) => json(pools[id] ?? null), {
    entries: async () =>
      Object.keys(pools).map((id) => [{ args: [{ toNumber: () => Number(id) }] }, json(pools[Number(id)])]),
  })
  return {
    consts: {},
    query: {
      nominationPools: { bondedPools },
      multiTokens: {
        tokenAccounts: async (_c: string, poolId: number) => json({ balance: poolId * 100 }),
        tokens: async () => json({ supply: 0 }),
      },
    },
  } as unknown as ApiPromise
}

describe("getStakedEnjBalances", () => {
  it("reports each pool's state", async () => {
    const out = await getStakedEnjBalances(fakeApi(), "enAlice", 1n)
    expect(out.map((h) => [h.poolId, h.poolName, h.poolState])).toEqual([
      [2, null, "Destroying"],
      [1, "One", "Open"],
    ])
  })
})

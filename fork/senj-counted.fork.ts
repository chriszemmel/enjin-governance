import { afterAll, beforeAll, describe, expect, inject, it } from "vitest"
import { stringToHex } from "@polkadot/util"
import { buildVote, listVotesOnPoll, sEnjCurrency } from "@/lib/governance/conviction-voting"
import { buildSubmit, extractReferendumIndex } from "@/lib/governance/referenda"
import { getStakedEnjBalances } from "@/lib/governance/staking-pools"
import { queryEntry, txCall } from "@/lib/chain/runtime"
import { CHAINS } from "@/lib/chain/chains"
import { defined } from "@/test/defined"
import { connectFork, ENJ, signAndInclude, type Fork } from "./chain"

/**
 * Runtime 1082 counts a vote made with sENJ at the pool's ENJ rate, not 1:1.
 * On a fork of Enjin Relay mainnet, an account holding sENJ of a live pool
 * votes with it, and the vote's `counted` amount, the referendum's tally and
 * what the app shows for it must all be the amount times the stake factor.
 */

const SENJ_COLLECTION = CHAINS["enjin-relay"].sEnjCollectionId ?? 1n
const POOL = 59
const HOLDER = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"

let fork: Fork
let referendum: number
let poolId: number

beforeAll(async () => {
  fork = await connectFork(inject("forkWs"))
  const remark = txCall(fork.api, "system", "remark")(stringToHex("senj counted")).method
  const submitted = await signAndInclude(
    fork,
    buildSubmit(fork.api, {
      origin: { System: "Root" },
      proposal: { inline: remark.toU8a() },
      enactment: { type: "After", block: 0 },
    }),
    fork.alice,
  )
  expect(submitted.ok, submitted.error ?? "").toBe(true)
  referendum = defined(extractReferendumIndex(submitted.events), "referendum index")

  // Bob gets 1,000 sENJ of pool 59: a token account copied from a real
  // holder of it (so its shape is the runtime's), with only the balance
  // changed. Mainnet referendum #20's voter holds it.
  const holder = await queryEntry(fork.api, "multiTokens", "tokenAccounts")(
    SENJ_COLLECTION,
    POOL,
    HOLDER,
  )
  poolId = POOL
  const shape = holder.toJSON() as Record<string, unknown>
  await fork.provider.send("dev_setStorage", [
    {
      MultiTokens: {
        TokenAccounts: [
          [
            [SENJ_COLLECTION.toString(), poolId, fork.bob.address],
            { ...shape, balance: (1000n * ENJ).toString(), lockedBalance: 0, locks: {} },
          ],
        ],
      },
    },
  ])
})

afterAll(async () => {
  await fork.api.disconnect()
})

async function ayes(): Promise<bigint> {
  const info = (await queryEntry(
    fork.api,
    "referenda",
    "referendumInfoFor",
  )(referendum)) as unknown as {
    unwrap: () => { asOngoing: { tally: { ayes: { toBigInt: () => bigint } } } }
  }
  return info.unwrap().asOngoing.tally.ayes.toBigInt()
}

describe("an sENJ vote on runtime 1082", () => {
  it("counts at the pool's ENJ rate: the stored amount, the tally, the app's readers", async () => {
    const [holding] = await getStakedEnjBalances(fork.api, fork.bob.address, SENJ_COLLECTION)
    const pool = defined(holding, "bob's sENJ holding")
    expect(pool.poolId).toBe(poolId)
    const rate = Number(pool.realEnjBalance) / Number(pool.senjBalance)
    expect(rate).toBeGreaterThan(1)

    const before = await ayes()
    const cast = 100n * ENJ
    const tx = buildVote(fork.api, {
      pollIndex: referendum,
      aye: true,
      balance: cast,
      conviction: "Locked1x",
      currency: sEnjCurrency(poolId),
    })
    const included = await signAndInclude(fork, tx, fork.bob)
    expect(included.ok, included.error ?? "").toBe(true)

    // The stored vote keeps what was cast and adds what is counted.
    const [row] = (await listVotesOnPoll(fork.api, referendum)).filter(
      (v) => v.voter === fork.bob.address,
    )
    const voted = defined(row, "bob's vote")
    expect(voted.vote).toMatchObject({ type: "Standard", balance: cast })
    const counted = defined(voted.counted, "counted amount")
    if (counted.type !== "Standard") throw new Error("counted is not a standard vote")
    expect(Number(counted.balance) / Number(cast)).toBeCloseTo(rate, 6)

    // The tally holds the counted amount (1x conviction), not the amount cast.
    expect((await ayes()) - before).toBe(counted.balance)
    expect(counted.balance).toBeGreaterThan(cast)
  })
})

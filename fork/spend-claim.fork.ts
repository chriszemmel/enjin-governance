import { afterAll, beforeAll, describe, expect, inject, it } from "vitest"
import { decodeAddress } from "@polkadot/util-crypto"
import { u8aToHex } from "@polkadot/util"
import {
  buildClaimPayout,
  claimReaders,
  findClaimBlock,
  claimSpendTarget,
  localSpendTarget,
  readTreasuryProposals,
  readTreasurySpends,
  resolveClaim,
  resolvePayout,
  type TreasurySpendEntry,
} from "@/lib/governance/payout"
import type { ProposalIntent } from "@/lib/governance/call-extract"
import { queryEntry } from "@/lib/chain/runtime"
import { defined } from "@/test/defined"
import { connectFork, dispatchAsOrigin, ENJ, newBlock, signAndInclude, type Fork } from "./chain"

/**
 * Both ways a treasury spend is paid, on a fork of Enjin Relay mainnet (spec
 * 1082), read back with the app's own readers:
 *
 *   - `treasury.spend` is claimed by anyone with `treasury.payout`, inside its
 *     window, and can't be after it;
 *   - `treasury.spendLocal` is paid at the next spend period, so the app keeps
 *     calling it pending, and the readers don't take one for the other.
 *
 * The calls are dispatched as the MediumSpender origin through the scheduler,
 * as a passed referendum's enactment would.
 */

const MEDIUM_SPENDER = { origins: "MediumSpender" }

let fork: Fork
let beneficiary: string
let beneficiaryHex: `0x${string}`

const freeBalance = async (who: string) =>
  (
    (await queryEntry(fork.api, "system", "account")(who)) as unknown as {
      data: { free: { toBigInt: () => bigint } }
    }
  ).data.free.toBigInt()

const target = (amount: bigint) => ({ beneficiary: beneficiaryHex, amount })
const intent = (method: "spend" | "spend_local", amount: bigint) =>
  ({ kind: "treasury-spend", method, beneficiary, amount }) as unknown as ProposalIntent

async function entryFor(amount: bigint): Promise<TreasurySpendEntry> {
  const spends = await readTreasurySpends(fork.api)
  return defined(
    spends.find((s) => s.amount === amount && s.beneficiary === beneficiaryHex),
    "the treasury.spends entry",
  )
}
const head = async () => (await fork.api.rpc.chain.getHeader()).number.toNumber()

beforeAll(async () => {
  fork = await connectFork(inject("forkWs"))
  beneficiary = fork.dave.address
  beneficiaryHex = u8aToHex(decodeAddress(beneficiary))
})

afterAll(async () => {
  await fork.api.disconnect()
})

describe("treasury.spend", () => {
  const AMOUNT = 123_456n * ENJ

  it("is open to claim once approved, for the window the pallet allows", async () => {
    const tx = fork.api.tx.treasury?.spend?.(null, AMOUNT, beneficiary, null)
    const dispatched = await dispatchAsOrigin(fork, defined(tx, "treasury.spend"), MEDIUM_SPENDER)
    expect(dispatched.ok).toBe(true)
    expect(dispatched.events).toContain("treasury.AssetSpendApproved")

    const entry = await entryFor(AMOUNT)
    expect(entry.status).toBe("pending")
    // The window is `treasury.payoutPeriod` blocks from the approval.
    const period = fork.api.consts.treasury?.payoutPeriod?.toString()
    expect(entry.expireAt - entry.validFrom).toBe(Number(period))

    expect(claimSpendTarget(intent("spend", AMOUNT))).toEqual(target(AMOUNT))
    expect(
      resolveClaim({
        record: null,
        spend: target(AMOUNT),
        spends: await readTreasurySpends(fork.api),
        currentBlock: await head(),
      }),
    ).toEqual({ status: "open", spendIndex: entry.index, expireAt: entry.expireAt })
  })

  it("anyone can claim it, the beneficiary is paid, and the app calls it paid", async () => {
    const entry = await entryFor(AMOUNT)
    const before = await freeBalance(beneficiary)

    // Alice isn't the beneficiary.
    // What the confirmation shows as the fee: the node's estimate for this call.
    const claim = buildClaimPayout(fork.api, entry.index)
    const estimate = (await claim.paymentInfo(fork.alice.address)).partialFee.toBigInt()
    const callerBefore = await freeBalance(fork.alice.address)

    const included = await signAndInclude(fork, claim, fork.alice)
    expect(included.ok, included.error ?? "").toBe(true)

    // The fee that was charged: to the caller (not the beneficiary), no more than
    // the estimate, and the whole of what the caller lost.
    const feePaid = defined(
      included.events.find(
        ({ event }) =>
          event.section === "transactionPayment" && event.method === "TransactionFeePaid",
      ),
      "TransactionFeePaid",
    )
    const actualFee = BigInt(feePaid.event.data[1]?.toString() ?? "0")
    process.stderr.write(`\nclaim fee: estimate ${estimate} planck, charged ${actualFee} planck\n`)
    expect(estimate).toBeGreaterThan(0n)
    expect(actualFee).toBeGreaterThan(0n)
    expect(actualFee).toBeLessThanOrEqual(estimate)
    expect(callerBefore - (await freeBalance(fork.alice.address))).toBe(actualFee)
    expect(included.events.map(({ event }) => `${event.section}.${event.method}`)).toContain(
      "treasury.Paid",
    )
    expect((await freeBalance(beneficiary)) - before).toBe(AMOUNT)

    // The app finds the block that paid it, from the chain's own history.
    const paidAt = await head()
    expect(
      await findClaimBlock({
        validFrom: entry.validFrom,
        currentBlock: paidAt,
        ...claimReaders(fork.api, entry.index),
      }),
    ).toBe(paidAt)
    await newBlock(fork)
    expect(
      await findClaimBlock({
        validFrom: entry.validFrom,
        currentBlock: await head(),
        ...claimReaders(fork.api, entry.index),
      }),
    ).toBe(paidAt)

    // The entry stays (attempted) until someone calls checkStatus.
    expect(await entryFor(AMOUNT)).toMatchObject({ index: entry.index, status: "attempted" })
    expect(
      resolveClaim({
        record: null,
        spend: target(AMOUNT),
        spends: await readTreasurySpends(fork.api),
        currentBlock: await head(),
      }).status,
    ).toBe("unknown")
    expect(
      resolveClaim({
        record: {
          block: entry.validFrom,
          ok: true,
          spends: [
            {
              proposalIndex: entry.index,
              amount: AMOUNT,
              beneficiary: beneficiaryHex,
              validFrom: entry.validFrom,
              expireAt: entry.expireAt,
            },
          ],
        },
        spend: target(AMOUNT),
        spends: await readTreasurySpends(fork.api),
        currentBlock: await head(),
      }),
    ).toEqual({ status: "paid", spendIndex: entry.index, validFrom: entry.validFrom })
  })

  it("can't be claimed after its window, and the app calls it expired", async () => {
    const EXPIRING = 77_000n * ENJ
    const tx = fork.api.tx.treasury?.spend?.(null, EXPIRING, beneficiary, null)
    expect((await dispatchAsOrigin(fork, defined(tx, "treasury.spend"), MEDIUM_SPENDER)).ok).toBe(
      true,
    )
    const entry = await entryFor(EXPIRING)

    // Move the window's end to the present, then past it.
    const now = await head()
    await fork.provider.send("dev_setStorage", [
      { Treasury: { Spends: [[[entry.index], { ...entry, assetKind: null, expireAt: now }]] } },
    ])
    await newBlock(fork)
    await newBlock(fork)

    const record = {
      block: entry.validFrom,
      ok: true,
      spends: [
        {
          proposalIndex: entry.index,
          amount: EXPIRING,
          beneficiary: beneficiaryHex,
          validFrom: entry.validFrom,
          expireAt: now,
        },
      ],
    }
    expect(
      resolveClaim({
        record,
        spend: target(EXPIRING),
        spends: await readTreasurySpends(fork.api),
        currentBlock: await head(),
      }),
    ).toEqual({ status: "expired", spendIndex: entry.index, expireAt: now })

    const before = await freeBalance(beneficiary)
    const late = await signAndInclude(fork, buildClaimPayout(fork.api, entry.index), fork.alice)
    expect(late.ok).toBe(false)
    expect(late.error ?? "").toMatch(/SpendExpired/i)
    expect(await freeBalance(beneficiary)).toBe(before)
  })
})

describe("treasury.spendLocal", () => {
  const AMOUNT = 31_000n * ENJ

  it("is still read as pending, and not taken for a treasury.spend", async () => {
    const tx = fork.api.tx.treasury?.spendLocal?.(AMOUNT, beneficiary)
    const dispatched = await dispatchAsOrigin(
      fork,
      defined(tx, "treasury.spendLocal"),
      MEDIUM_SPENDER,
    )
    expect(dispatched.ok).toBe(true)
    expect(dispatched.events).toContain("treasury.SpendApproved")

    expect(localSpendTarget(intent("spend_local", AMOUNT))).toEqual(target(AMOUNT))
    expect(claimSpendTarget(intent("spend_local", AMOUNT))).toBeNull()
    expect(localSpendTarget(intent("spend", AMOUNT))).toBeNull()

    const { proposals, approvals } = await readTreasuryProposals(fork.api)
    expect(
      resolvePayout({ record: null, spend: target(AMOUNT), proposals, approvals }).status,
    ).toBe("pending")
    // Not a treasury.spend: nothing for the claim reader to find.
    expect(
      resolveClaim({
        record: null,
        spend: target(AMOUNT),
        spends: await readTreasurySpends(fork.api),
        currentBlock: await head(),
      }).status,
    ).toBe("unknown")
  })
})

/**
 * The payout of a treasury `spend_local` after its referendum is enacted.
 *
 * `treasury.spend_local` doesn't pay anyone itself: it stores a treasury
 * proposal (`treasury.proposals(i)`, with `i` appended to
 * `treasury.approvals`) and emits `SpendApproved`. The treasury pays the
 * approved proposals in its `on_initialize` at the next spend period - the
 * blocks divisible by `treasury.spendPeriod` (14,400 on Enjin Relay) - if
 * the pot covers them, and removes them from both. Mainnet referendum #12
 * was enacted at 17,547,682 and its proposal #6 was awarded at 17,553,600.
 */

import type { ApiPromise } from "@polkadot/api"
import { u8aToHex } from "@polkadot/util"
import { decodeAddress } from "@polkadot/util-crypto"
import type { ProposalIntent } from "./call-extract"
import type { EnactmentRecord } from "./scheduler"

/** A `treasury.proposals` entry. */
export type TreasuryProposalEntry = {
  index: number
  /** Beneficiary public key, hex. */
  beneficiary: `0x${string}`
  value: bigint
}

/** Where a spend's treasury proposal stands after enactment. */
export type PayoutStatus =
  /** Can't be told from chain state (or not read yet). */
  | { status: "unknown" }
  /** Approved and waiting for a spend period. */
  | { status: "pending"; proposalIndex: number | null }
  /** The proposal was created and has since left the treasury: paid. */
  | { status: "paid"; proposalIndex: number | null }
  /** The enacted call failed, so there is nothing to pay. */
  | { status: "none" }

/** The spend a referendum's call makes, keyed for matching against treasury proposals. */
export type SpendTarget = {
  /** Beneficiary public key, hex. */
  beneficiary: `0x${string}`
  amount: bigint
}

/**
 * The spend a `treasury.spendLocal` intent makes, or null for anything else
 * (`treasury.spend` pays through `treasury.payout`, not a spend period).
 */
export function localSpendTarget(intent: ProposalIntent | undefined): SpendTarget | null {
  if (!intent || intent.kind !== "treasury-spend") return null
  if (intent.method !== "spend_local" && intent.method !== "spendLocal") return null
  try {
    return { beneficiary: u8aToHex(decodeAddress(intent.beneficiary)), amount: intent.amount }
  } catch {
    return null
  }
}

/**
 * The first spend-period block after `block`: payouts happen at the blocks
 * divisible by `spendPeriod`, and one at `block` itself has already run.
 */
export function nextSpendPeriodBlock(block: number, spendPeriod: number): number {
  if (!(spendPeriod > 0)) return block + 1
  return (Math.floor(block / spendPeriod) + 1) * spendPeriod
}

/**
 * Where an enacted spend's payout stands, from current treasury state and
 * (when the archive could read it) the enactment's own events.
 *
 * With the enactment record, the proposal index is the one its
 * `SpendApproved` announced: still in `proposals` and `approvals` → pending,
 * gone → paid. A failed dispatch → none. Without it, a proposal with the
 * same beneficiary and amount in `approvals` → pending; no such proposal is
 * left unknown rather than called paid, since a spend that failed at
 * enactment never created one.
 */
export function resolvePayout(input: {
  record: EnactmentRecord | null
  spend: SpendTarget
  proposals: readonly TreasuryProposalEntry[]
  approvals: readonly number[]
}): PayoutStatus {
  const { record, spend, proposals, approvals } = input
  if (record?.ok === false) return { status: "none" }

  const sameSpend = (beneficiary: string, amount: bigint) =>
    beneficiary.toLowerCase() === spend.beneficiary.toLowerCase() && amount === spend.amount

  const approved = record?.spends.find((s) => sameSpend(s.beneficiary, s.amount))
  if (approved) {
    const stored = proposals.find((p) => p.index === approved.proposalIndex)
    if (!stored) return { status: "paid", proposalIndex: approved.proposalIndex }
    return approvals.includes(approved.proposalIndex)
      ? { status: "pending", proposalIndex: approved.proposalIndex }
      : { status: "unknown" }
  }

  const waiting = proposals.filter(
    (p) => sameSpend(p.beneficiary, p.value) && approvals.includes(p.index),
  )
  if (waiting.length > 0) {
    return { status: "pending", proposalIndex: waiting.length === 1 ? waiting[0].index : null }
  }
  return { status: "unknown" }
}

/** `treasury.spendPeriod`, or null when the runtime has no treasury. */
export function readSpendPeriod(api: ApiPromise): number | null {
  const raw = api.consts.treasury?.spendPeriod as { toNumber?: () => number } | undefined
  return raw?.toNumber ? raw.toNumber() : null
}

/** The treasury's stored proposals and the approved indices waiting for a spend period. */
export async function readTreasuryProposals(
  api: ApiPromise,
): Promise<{ proposals: TreasuryProposalEntry[]; approvals: number[] }> {
  const treasury = api.query.treasury
  if (!treasury?.proposals || !treasury.approvals) {
    throw new Error("Chain does not expose treasury.proposals")
  }
  const [entries, approvals] = await Promise.all([
    treasury.proposals.entries(),
    treasury.approvals(),
  ])
  const proposals: TreasuryProposalEntry[] = []
  for (const [key, value] of entries) {
    const opt = value as unknown as { isSome?: boolean; unwrap: () => unknown }
    const proposal = (opt.isSome === false ? null : opt.isSome ? opt.unwrap() : value) as {
      beneficiary: { toU8a: () => Uint8Array }
      value: { toBigInt: () => bigint }
    } | null
    if (!proposal) continue
    proposals.push({
      index: (key.args[0] as unknown as { toNumber: () => number }).toNumber(),
      beneficiary: u8aToHex(proposal.beneficiary.toU8a()),
      value: proposal.value.toBigInt(),
    })
  }
  const indices = Array.from(approvals as unknown as ArrayLike<{ toNumber: () => number }>, (i) =>
    i.toNumber(),
  )
  return { proposals, approvals: indices }
}

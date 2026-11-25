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
import { queryEntry, txCall } from "@/lib/chain/runtime"

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
  /**
   * The proposal was created and has since left the treasury: paid. `block`
   * is the spend period it was awarded at, once found (`findAwardBlock`).
   */
  | { status: "paid"; proposalIndex: number | null; block?: number | null }
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
 * The spend a `treasury.spend` intent makes, or null for anything else. Unlike
 * `spend_local`, it is paid when someone calls `treasury.payout`, within the
 * window the spend is valid for.
 */
export function claimSpendTarget(intent: ProposalIntent | undefined): SpendTarget | null {
  if (!intent || intent.kind !== "treasury-spend" || intent.method !== "spend") return null
  try {
    return { beneficiary: u8aToHex(decodeAddress(intent.beneficiary)), amount: intent.amount }
  } catch {
    return null
  }
}

/**
 * What the proposal page says an approved treasury spend does, by the call it
 * is. A `spend_local` pays from the treasury by itself at the next spend
 * period; a `spend` is paid when someone claims it.
 */
export function spendDispatchNote(method: string, chainName: string): string {
  return method === "spend"
    ? `and approves the spend. Once it is enacted, anyone can claim the payout to the beneficiary from the ${chainName} treasury.`
    : `and pays the beneficiary from the ${chainName} treasury.`
}

/**
 * What the create page says under the amount: a `treasury.spend` isn't paid
 * by itself, it is claimed once the referendum is enacted, within a window
 * (`window`, as a duration like "30d", when the chain's is known).
 */
export function claimNote(window: string | null): string {
  return `Once the referendum is enacted, you or anyone else claims the payout on the proposal page. It goes to the beneficiary.${
    window ? ` Claim it within ${window}, or it expires.` : ""
  }`
}

/** A `treasury.spends` entry: a `treasury.spend` waiting to be paid out. */
export type TreasurySpendEntry = {
  index: number
  /** Beneficiary public key, hex. */
  beneficiary: `0x${string}`
  amount: bigint
  /** The first block it can be paid out. */
  validFrom: number
  /** The block after which it can't be. */
  expireAt: number
  /** `pending`: not paid yet. `attempted`: paid out (until `checkStatus` clears it). `failed`: the payment failed, to retry. */
  status: "pending" | "attempted" | "failed"
}

/** Where the payout of a `treasury.spend` stands, after enactment. */
export type ClaimStatus =
  /** Can't be told from chain state (or not read yet). */
  | { status: "unknown" }
  /** Ready to be paid out by anyone, until `expireAt`. */
  | { status: "open"; spendIndex: number; expireAt: number }
  /** Paid out; `block` is where, once found (`findClaimBlock`), and `validFrom` where to start looking. */
  | { status: "paid"; spendIndex: number; validFrom?: number | null; block?: number | null }
  /** Not paid out in its window; the funds never left the treasury. */
  | { status: "expired"; spendIndex: number; expireAt: number }
  /** The entry is gone: paid out, or lapsed and cleared, which the state alone can't tell apart. */
  | { status: "closed"; spendIndex: number | null }
  /** The enacted call failed, so there is nothing to claim. */
  | { status: "none" }

/**
 * Where an enacted `treasury.spend` stands, from `treasury.spends` and, when
 * the archive could read it, the enactment's own `AssetSpendApproved`.
 *
 * With the record, the spend's index is the one the event announced. Without
 * it, a pending spend with the same beneficiary and amount is taken (the
 * latest one). An entry whose window has passed is expired, one the payout
 * has attempted is paid. A spend that is gone and was approved by the record
 * is paid while its window lasts, and closed after (it could also have lapsed).
 */
export function resolveClaim(input: {
  record: EnactmentRecord | null
  spend: SpendTarget
  spends: readonly TreasurySpendEntry[]
  currentBlock: number | null
}): ClaimStatus {
  const { record, spend, spends, currentBlock } = input
  if (record?.ok === false) return { status: "none" }

  const same = (beneficiary: string, amount: bigint) =>
    beneficiary.toLowerCase() === spend.beneficiary.toLowerCase() && amount === spend.amount

  const approved = record?.spends.find((s) => s.validFrom != null && same(s.beneficiary, s.amount))
  const entry = approved
    ? spends.find((e) => e.index === approved.proposalIndex)
    : spends
        .filter((e) => e.status === "pending" && same(e.beneficiary, e.amount))
        .sort((a, b) => b.index - a.index)[0]

  if (entry) {
    if (entry.status === "attempted") {
      return { status: "paid", spendIndex: entry.index, validFrom: entry.validFrom }
    }
    if (currentBlock != null && currentBlock > entry.expireAt) {
      return { status: "expired", spendIndex: entry.index, expireAt: entry.expireAt }
    }
    return { status: "open", spendIndex: entry.index, expireAt: entry.expireAt }
  }
  if (approved) {
    const expireAt = approved.expireAt ?? null
    return currentBlock != null && expireAt != null && currentBlock > expireAt
      ? { status: "closed", spendIndex: approved.proposalIndex }
      : { status: "paid", spendIndex: approved.proposalIndex, validFrom: approved.validFrom ?? null }
  }
  return { status: "unknown" }
}

/**
 * The block a `treasury.spend` was paid out at: the first block from `validFrom`
 * at whose state the spend is no longer pending (it stays pending until the
 * payout is attempted, and never goes back), confirmed by that block's
 * `treasury.Paid` event for it, found by binary search in a few archive reads.
 * Null when it was never paid by `currentBlock` (it may have expired instead).
 */
export async function findClaimBlock(input: {
  validFrom: number
  currentBlock: number
  /** Whether, after `block`, the spend is no longer waiting to be paid. */
  settled: (block: number) => Promise<boolean>
  /** Whether `block`'s events pay the spend out. */
  paid: (block: number) => Promise<boolean>
}): Promise<number | null> {
  const { validFrom, currentBlock, settled, paid } = input
  if (!(currentBlock >= validFrom) || !(await settled(currentBlock))) return null
  let lo = validFrom
  let hi = currentBlock
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (await settled(mid)) hi = mid
    else lo = mid + 1
  }
  return (await paid(lo)) ? lo : null
}

/** `findClaimBlock`'s chain reads for `treasury.spends` entry `spendIndex`, on an archive node. */
export function claimReaders(
  api: ApiPromise,
  spendIndex: number,
): { settled: (block: number) => Promise<boolean>; paid: (block: number) => Promise<boolean> } {
  const at = async (block: number) => api.at(await api.rpc.chain.getBlockHash(block))
  return {
    settled: async (block) => {
      const state = await at(block)
      const entry = (await queryEntry(state, "treasury", "spends")(spendIndex)) as unknown as {
        isSome: boolean
        unwrap: () => { status: { isPending: boolean } }
      }
      return !(entry.isSome && entry.unwrap().status.isPending)
    },
    paid: async (block) => {
      const state = await at(block)
      const events = (await queryEntry(state, "system", "events")()) as unknown as {
        event: { section: string; method: string; data: ArrayLike<unknown> }
      }[]
      return events.some(
        ({ event }) =>
          event.section === "treasury" &&
          event.method === "Paid" &&
          Number((event.data[0] as { toString: () => string }).toString()) === spendIndex,
      )
    },
  }
}

/** `treasury.payout(index)`: pays a `treasury.spend` out to its beneficiary. Anyone can send it. */
export function buildClaimPayout(api: Pick<ApiPromise, "tx">, index: number) {
  return txCall(api, "treasury", "payout")(index)
}

/**
 * The first spend-period block after `block`, and one at `block` itself has
 * already run. Spend periods fall at `origin + k * spendPeriod`. Older
 * treasuries pay at the blocks divisible by `spendPeriod` (origin 0); newer
 * ones count from `treasury.lastSpendPeriod`, which need not be a multiple
 * of the period once the period has been changed (Enjin Relay's runtime 1082
 * set 345,600 with the last period at 18,259,200, so payouts fall at
 * 18,604,800, not at 18,662,400).
 */
export function nextSpendPeriodBlock(block: number, spendPeriod: number, origin = 0): number {
  if (!(spendPeriod > 0)) return block + 1
  if (block < origin) return origin + spendPeriod
  return origin + (Math.floor((block - origin) / spendPeriod) + 1) * spendPeriod
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

  const approved = record?.spends.find(
    (s) => s.validFrom == null && sameSpend(s.beneficiary, s.amount),
  )
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
  const [first, ...others] = waiting
  if (first) {
    return { status: "pending", proposalIndex: others.length === 0 ? first.index : null }
  }
  return { status: "unknown" }
}

/**
 * The block a paid spend was awarded at: the first spend period after its
 * enactment at whose block the treasury proposal is gone, confirmed by that
 * block's `treasury.Awarded` event for the proposal. The proposal is stored
 * until the period that pays it and never after, so a binary search over the
 * periods finds it in a few archive reads, however long the pot made it wait.
 * Mainnet referendum #14's proposal #7, enacted at 17,637,452, was awarded at
 * 17,640,000. Null when no period up to `currentBlock` paid it.
 */
export async function findAwardBlock(input: {
  enactedAt: number
  currentBlock: number
  spendPeriod: number
  /** Where the periods count from (`treasury.lastSpendPeriod` at enactment); 0 when it has none. */
  origin?: number
  /** Whether the proposal is still stored in the state after `block`. */
  stored: (block: number) => Promise<boolean>
  /** Whether `block`'s events award the proposal. */
  awarded: (block: number) => Promise<boolean>
}): Promise<number | null> {
  const { enactedAt, currentBlock, spendPeriod, origin = 0, stored, awarded } = input
  if (!(spendPeriod > 0)) return null
  // Period k falls at origin + k * spendPeriod.
  const first = nextSpendPeriodBlock(enactedAt, spendPeriod, origin)
  let lo = Math.round((first - origin) / spendPeriod)
  let hi = Math.floor((currentBlock - origin) / spendPeriod)
  if (lo > hi || (await stored(origin + hi * spendPeriod))) return null
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (await stored(origin + mid * spendPeriod)) lo = mid + 1
    else hi = mid
  }
  const block = origin + lo * spendPeriod
  return (await awarded(block)) ? block : null
}

/** `findAwardBlock`'s chain reads for treasury proposal `proposalIndex`, on an archive node. */
export function awardReaders(
  api: ApiPromise,
  proposalIndex: number,
): { stored: (block: number) => Promise<boolean>; awarded: (block: number) => Promise<boolean> } {
  const at = async (block: number) => api.at(await api.rpc.chain.getBlockHash(block))
  return {
    stored: async (block) => {
      const state = await at(block)
      const entry = await queryEntry(state, "treasury", "proposals")(proposalIndex)
      return (entry as unknown as { isSome: boolean }).isSome
    },
    awarded: async (block) => {
      const state = await at(block)
      const events = (await queryEntry(state, "system", "events")()) as unknown as {
        event: { section: string; method: string; data: { toJSON: () => unknown } }
      }[]
      return events.some(({ event }) => {
        if (event.section !== "treasury" || event.method !== "Awarded") return false
        const data = event.data.toJSON() as unknown[] | Record<string, unknown>
        const index = Array.isArray(data) ? data[0] : data.proposalIndex
        return Number(index) === proposalIndex
      })
    },
  }
}

/** `treasury.spendPeriod`, or null when the runtime has no treasury. */
export function readSpendPeriod(api: Pick<ApiPromise, "consts">): number | null {
  const raw = api.consts.treasury?.spendPeriod as { toNumber?: () => number } | undefined
  return raw?.toNumber ? raw.toNumber() : null
}

/**
 * `treasury.spendPeriod` as it was at `block`, on an archive node. A runtime
 * upgrade can change it (Canary went from 14,400 to 345,600), and a spend was
 * awarded on a multiple of the period of its own time, so dating one needs
 * that period, not today's.
 */
export async function readSpendPeriodAt(api: ApiPromise, block: number): Promise<number | null> {
  return readSpendPeriod(await api.at(await api.rpc.chain.getBlockHash(block)))
}

/**
 * `treasury.lastSpendPeriod` at `block` (or now, without one): the block the
 * spend periods count from. Null when the runtime has no such storage, which
 * means they fall at multiples of the period.
 */
export async function readLastSpendPeriod(api: ApiPromise, block?: number): Promise<number | null> {
  const state = block == null ? api : await api.at(await api.rpc.chain.getBlockHash(block))
  const entry = (state.query.treasury as Record<string, unknown> | undefined)?.lastSpendPeriod as
    | (() => Promise<{ isSome?: boolean; unwrap?: () => { toNumber: () => number } }>)
    | undefined
  if (!entry) return null
  const value = await entry()
  return value.isSome && value.unwrap ? value.unwrap().toNumber() : null
}

/** Every `treasury.spends` entry: the `treasury.spend`s that are waiting for a payout, or not yet cleared. */
export async function readTreasurySpends(api: ApiPromise): Promise<TreasurySpendEntry[]> {
  const spends = api.query.treasury?.spends
  if (!spends) return []
  const out: TreasurySpendEntry[] = []
  for (const [key, value] of await spends.entries()) {
    const opt = value as unknown as { isSome?: boolean; unwrap: () => unknown }
    const raw = (opt.isSome === false ? null : opt.isSome ? opt.unwrap() : value) as {
      amount: { toBigInt: () => bigint }
      beneficiary: { toU8a: () => Uint8Array }
      validFrom: { toNumber: () => number }
      expireAt: { toNumber: () => number }
      status: { isPending?: boolean; isAttempted?: boolean; isFailed?: boolean }
    } | null
    if (!raw) continue
    out.push({
      index: (key.args[0] as unknown as { toNumber: () => number }).toNumber(),
      beneficiary: u8aToHex(raw.beneficiary.toU8a()),
      amount: raw.amount.toBigInt(),
      validFrom: raw.validFrom.toNumber(),
      expireAt: raw.expireAt.toNumber(),
      status: raw.status.isAttempted ? "attempted" : raw.status.isFailed ? "failed" : "pending",
    })
  }
  return out
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

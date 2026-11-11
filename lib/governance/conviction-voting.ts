/**
 * Helpers around Enjin Relay's vote pallet. Mainnet and canary (both spec
 * 1070) run `pallet_multi_token_conviction_voting`, a multi-token fork of
 * stock `pallet_conviction_voting` that is registered as `convictionVoting`
 * (`api.tx.convictionVoting` / `api.query.convictionVoting`). Neither has a
 * `voteManager` pallet: the voteManager branches below only serve a runtime
 * that exposes one, and the arity probes keep stock Substrate (Polkadot /
 * Kusama) working.
 *
 * The fork extends the standard calls with a `currency` argument so a
 * single voter can stake either liquid ENJ or staked-ENJ derivatives
 * (sENJ pool tokens) into a referendum. We pass `{ Enj: null }` for
 * regular voting; staked-ENJ flows supply `sEnjCurrency(poolId)`.
 *
 * Vote builders return unsigned extrinsics; signing is the caller's job.
 */

import type { ApiPromise } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { ISubmittableResult } from "@polkadot/types/types"
import {
  CONVICTION_LOCK_PERIODS,
  CONVICTION_MULTIPLIER,
  type ClassLock,
  type Conviction,
  type VoteRecord,
} from "./types"

type Tx = SubmittableExtrinsic<"promise", ISubmittableResult>

/**
 * Currency enum on Enjin's multi-token convictionVoting fork
 * (`pallet_multi_token_conviction_voting::types::VoteCurrency`). Mirrors
 * the on-chain shape exactly:
 *
 *   enum VoteCurrency {
 *     Enj,
 *     SEnj { tokenId: Compact<u128> },
 *   }
 *
 * Subscan flattens this to `{ SEnj: "34" }` in its UI, but the
 * runtime decoder requires the inner struct. Passing a flat number
 * (`{ SEnj: 34 }`) fails decoding with "Cannot decode value 34
 * (typeof number), expected an input object, map or array".
 */
export type VoteCurrency =
  | { Enj: null }
  | { SEnj: { tokenId: number | string | bigint } }
const ENJ: VoteCurrency = { Enj: null }

export function sEnjCurrency(poolId: number): VoteCurrency {
  return { SEnj: { tokenId: poolId } }
}

/**
 * `convictionVoting.voteLockingPeriod` on Enjin Relay: 100,800 blocks (7
 * days at 6s) on both mainnet and canary at spec 1070. Only stands in until
 * the api is connected - `getVoteLockingPeriod` reads the live value.
 */
export const DEFAULT_VOTE_LOCKING_PERIOD = 100_800

/**
 * The runtime's conviction-lock unit, in blocks. A winning-side Standard
 * vote stays locked until its referendum's end block plus
 * `CONVICTION_LOCK_PERIODS[conviction] × voteLockingPeriod` - the same on
 * every track, whatever the track's decision period. Falls back to
 * DEFAULT_VOTE_LOCKING_PERIOD while the api isn't ready or when the
 * runtime doesn't expose the constant.
 */
export function getVoteLockingPeriod(api: ApiPromise | null | undefined): number {
  const raw =
    api?.consts.convictionVoting?.voteLockingPeriod ??
    api?.consts.voteManager?.voteLockingPeriod
  const blocks = raw == null ? Number.NaN : toNumber(raw)
  return Number.isFinite(blocks) && blocks > 0 ? blocks : DEFAULT_VOTE_LOCKING_PERIOD
}

/** Blocks a Standard vote at `conviction` stays locked after its referendum ends. */
export function convictionLockBlocks(conviction: Conviction, voteLockingPeriod: number): number {
  return CONVICTION_LOCK_PERIODS[conviction] * voteLockingPeriod
}

function hasVoteManager(api: ApiPromise): boolean {
  return Boolean(api.tx.voteManager)
}

/**
 * Detect whether the runtime's `convictionVoting.vote` extrinsic expects
 * an extra `currency` arg. Enjin's multi-token fork (mainnet and canary)
 * takes 3 args (poll_index, vote, currency); stock Substrate / Polkadot
 * takes 2.
 *
 * Returns null on chains without convictionVoting at all.
 */
function convictionVotingArgCount(api: ApiPromise): number | null {
  const vote = api.tx.convictionVoting?.vote
  if (!vote) return null
  try {
    const args = vote.meta.args as unknown as { length: number }
    return args.length
  } catch {
    return null
  }
}

/**
 * Generic version of the above for any extrinsic on either pallet.
 * Returns null when the call doesn't exist. Used by removeVote / unlock
 * / delegate which can also drift in arity between runtimes.
 */
function extrinsicArgCount(
  api: ApiPromise,
  pallet: "convictionVoting" | "voteManager",
  call: string,
): number | null {
  const tx = (api.tx[pallet] as Record<string, { meta: { args: unknown } } | undefined>)?.[call]
  if (!tx) return null
  try {
    const args = tx.meta.args as unknown as { length: number }
    return args.length
  } catch {
    return null
  }
}

export type VoteParams = {
  pollIndex: number
  aye: boolean
  balance: bigint
  conviction: Conviction
  currency?: VoteCurrency
}

export function buildVote(api: ApiPromise, params: VoteParams): Tx {
  const accountVote = {
    Standard: {
      vote: { aye: params.aye, conviction: params.conviction },
      balance: params.balance.toString(),
    },
  }
  return buildVoteExtrinsic(api, params.pollIndex, accountVote, params.currency)
}

export type SplitVoteParams = {
  pollIndex: number
  aye: bigint
  nay: bigint
  currency?: VoteCurrency
}

export function buildSplitVote(api: ApiPromise, params: SplitVoteParams): Tx {
  const accountVote = {
    Split: { aye: params.aye.toString(), nay: params.nay.toString() },
  }
  return buildVoteExtrinsic(api, params.pollIndex, accountVote, params.currency)
}

export type SplitAbstainVoteParams = SplitVoteParams & { abstain: bigint }

export function buildSplitAbstainVote(
  api: ApiPromise,
  params: SplitAbstainVoteParams,
): Tx {
  const accountVote = {
    SplitAbstain: {
      aye: params.aye.toString(),
      nay: params.nay.toString(),
      abstain: params.abstain.toString(),
    },
  }
  return buildVoteExtrinsic(api, params.pollIndex, accountVote, params.currency)
}

/**
 * Pick the right pallet + arity for the current runtime and dispatch the
 * vote call. Enjin mainnet and canary expose the multi-token
 * `convictionVoting.vote` (3 args including currency); stock Substrate /
 * Polkadot only takes 2. `voteManager.vote` wins on a runtime that has it.
 */
function buildVoteExtrinsic(
  api: ApiPromise,
  pollIndex: number,
  accountVote: unknown,
  currency: VoteCurrency | undefined,
): Tx {
  if (hasVoteManager(api)) {
    return api.tx.voteManager.vote(pollIndex, accountVote, currency ?? ENJ) as Tx
  }
  const argCount = convictionVotingArgCount(api)
  if (argCount === 3) {
    return api.tx.convictionVoting.vote(
      pollIndex,
      accountVote,
      currency ?? ENJ,
    ) as Tx
  }
  return api.tx.convictionVoting.vote(pollIndex, accountVote) as Tx
}

export function buildRemoveVote(
  api: ApiPromise,
  trackId: number,
  pollIndex: number,
  currency?: VoteCurrency,
): Tx {
  // Enjin's multi-token convictionVoting (and a voteManager, where a
  // runtime has one) takes (class, index, currency). Stock Substrate
  // convictionVoting only takes (class, index). Detect from metadata so we
  // don't hard-code.
  if (hasVoteManager(api)) {
    const argCount = extrinsicArgCount(api, "voteManager", "removeVote")
    if (argCount === 3) {
      return api.tx.voteManager.removeVote(
        trackId,
        pollIndex,
        currency ?? ENJ,
      ) as Tx
    }
    return api.tx.voteManager.removeVote(trackId, pollIndex) as Tx
  }
  const argCount = extrinsicArgCount(api, "convictionVoting", "removeVote")
  if (argCount === 3) {
    return api.tx.convictionVoting.removeVote(
      trackId,
      pollIndex,
      currency ?? ENJ,
    ) as Tx
  }
  return api.tx.convictionVoting.removeVote(trackId, pollIndex) as Tx
}

/**
 * Build the unlock extrinsic - frees expired locks for `target`.
 *
 * Enjin's multi-token `convictionVoting.unlock` (mainnet and canary) takes
 * (class, target, currency) - 3 args - because locks are held per currency;
 * stock Substrate takes (class, target). Probe metadata for the real arity
 * so we pass `currency` only when the runtime expects it (omitting it throws
 * "expected 3 arguments, found 2" at construction).
 *
 * NOTE: the lock is per currency. Unlocking ENJ does NOT free an sENJ lock on
 * the same track - callers holding sENJ locks must pass that currency. We
 * default to ENJ, which covers the common liquid-ENJ case.
 */
export function buildUnlock(
  api: ApiPromise,
  trackId: number,
  target: string,
  currency?: VoteCurrency,
): Tx {
  if (hasVoteManager(api)) {
    const argCount = extrinsicArgCount(api, "voteManager", "unlock")
    if (argCount === 3) {
      return api.tx.voteManager.unlock(trackId, target, currency ?? ENJ) as Tx
    }
    return api.tx.voteManager.unlock(trackId, target) as Tx
  }
  const argCount = extrinsicArgCount(api, "convictionVoting", "unlock")
  if (argCount === 3) {
    return api.tx.convictionVoting.unlock(trackId, target, currency ?? ENJ) as Tx
  }
  return api.tx.convictionVoting.unlock(trackId, target) as Tx
}

export type DelegateParams = {
  trackId: number
  to: string
  conviction: Conviction
  balance: bigint
  currency?: VoteCurrency
}

export function buildDelegate(api: ApiPromise, params: DelegateParams): Tx {
  // Stock Substrate convictionVoting.delegate takes (class, to, conviction,
  // balance) = 4 args; Enjin's multi-token-aware variant appends `currency`
  // = 5 args. Probe metadata for the real arity instead of hard-coding it,
  // so a future runtime that drops/changes the currency arg doesn't throw
  // at construction (or silently pass `currency` into the wrong slot).
  if (hasVoteManager(api)) {
    const argCount = extrinsicArgCount(api, "voteManager", "delegate")
    if (argCount === 5) {
      return api.tx.voteManager.delegate(
        params.trackId,
        params.to,
        params.conviction,
        params.balance.toString(),
        params.currency ?? ENJ,
      ) as Tx
    }
    return api.tx.voteManager.delegate(
      params.trackId,
      params.to,
      params.conviction,
      params.balance.toString(),
    ) as Tx
  }
  const argCount = extrinsicArgCount(api, "convictionVoting", "delegate")
  if (argCount === 5) {
    return api.tx.convictionVoting.delegate(
      params.trackId,
      params.to,
      params.conviction,
      params.balance.toString(),
      params.currency ?? ENJ,
    ) as Tx
  }
  return api.tx.convictionVoting.delegate(
    params.trackId,
    params.to,
    params.conviction,
    params.balance.toString(),
  ) as Tx
}

/**
 * Build the undelegate extrinsic. Enjin's multi-token
 * `convictionVoting.undelegate` takes (class, currency) - 2 args - since a
 * delegation is per currency; stock Substrate takes (class). Probe arity so
 * we pass `currency` only when expected (defaulting to ENJ).
 */
export function buildUndelegate(
  api: ApiPromise,
  trackId: number,
  currency?: VoteCurrency,
): Tx {
  if (hasVoteManager(api)) {
    const argCount = extrinsicArgCount(api, "voteManager", "undelegate")
    if (argCount === 2) {
      return api.tx.voteManager.undelegate(trackId, currency ?? ENJ) as Tx
    }
    return api.tx.voteManager.undelegate(trackId) as Tx
  }
  const argCount = extrinsicArgCount(api, "convictionVoting", "undelegate")
  if (argCount === 2) {
    return api.tx.convictionVoting.undelegate(trackId, currency ?? ENJ) as Tx
  }
  return api.tx.convictionVoting.undelegate(trackId) as Tx
}

function voteQuery(api: ApiPromise) {
  // Vote *state* (VotingFor / ClassLocksFor) lives on convictionVoting -
  // on Enjin the multi-token fork, whose maps carry the currency as an
  // extra key. A runtime with a voteManager pallet might expose the state
  // there instead - accept either.
  if (api.query.convictionVoting?.votingFor) return api.query.convictionVoting
  return api.query.voteManager
}

/** Read every vote `address` has cast on `trackId`. */
export async function getVotesFor(
  api: ApiPromise,
  address: string,
  trackId: number,
): Promise<VoteRecord[]> {
  const all = await getVotesAcrossCurrencies(api, address, trackId)
  return all.map((e) => e.vote)
}

export type MyVoteOnPoll = {
  vote: VoteRecord
  /** Raw chain-shape currency variant ({ Enj: null } | { SEnj: { tokenId } } | null). */
  currencyRaw: unknown
}

/**
 * Every vote the user has cast on a specific poll, one entry per
 * currency. A wallet can cast independent ENJ + per-pool sENJ votes
 * on the same poll, so this returns an array even for a single voter.
 *
 * Sorted by raw voting weight (balance * conviction multiplier)
 * descending so the highest-impact source surfaces first when the
 * UI renders them as a stack or swiper.
 */
export async function getMyVotesOnPoll(
  api: ApiPromise,
  address: string,
  trackId: number,
  pollIndex: number,
): Promise<MyVoteOnPoll[]> {
  const all = await getVotesAcrossCurrencies(api, address, trackId)
  const matches = all.filter((e) => e.vote.pollIndex === pollIndex)
  matches.sort((a, b) => Number(voteWeight(b.vote) - voteWeight(a.vote)))
  return matches
}

/**
 * Like getMyVotesOnPoll but for callers that DON'T know the trackId - e.g. a
 * terminal referendum, whose decoded `Referendum.trackId` is null. Enumerates
 * the address's votes across every track via the address-prefixed `votingFor`
 * entries and recovers each trackId from the storage key. Because votes (and
 * their conviction locks) persist on chain after a referendum concludes, this
 * lets the detail page still offer "remove vote" in place - each returned vote
 * carries its own trackId so removeVote can target the right class.
 */
export async function getMyVotesOnPollAnyTrack(
  api: ApiPromise,
  address: string,
  pollIndex: number,
): Promise<MyVoteOnPoll[]> {
  const q = voteQuery(api)
  if (!q?.votingFor) return []

  let entries: Array<[unknown, unknown]> | null = null
  try {
    entries = (await q.votingFor.entries(address)) as Array<[unknown, unknown]>
  } catch {
    entries = null
  }
  if (entries == null) return []

  const out: MyVoteOnPoll[] = []
  for (const [key, value] of entries) {
    const args = (key as {
      args: Array<{ toJSON?: () => unknown; toString: () => string; toNumber?: () => number }>
    }).args
    // address-prefixed entries: args[0]=address, args[1]=trackId, args[2]=currency.
    const trackCodec = args[1]
    if (!trackCodec) continue
    const trackId = trackCodec.toNumber?.() ?? Number(trackCodec.toString())
    if (!Number.isFinite(trackId)) continue
    const currencyRaw = args[2]?.toJSON?.() ?? null
    const votes = decodeVotes(value, trackId)
    for (const v of votes) {
      if (v.pollIndex === pollIndex) out.push({ vote: v, currencyRaw })
    }
  }
  out.sort((a, b) => Number(voteWeight(b.vote) - voteWeight(a.vote)))
  return out
}

function voteWeight(v: VoteRecord): bigint {
  // Conviction multipliers are 0.1 / 1 / 2 / 3 / 4 / 5 / 6. Scale by
  // 10 so the 0.1x rung stays distinguishable from zero in bigint.
  if (v.type === "Standard") {
    const scaled = BigInt(Math.round(CONVICTION_MULTIPLIER[v.conviction] * 10))
    return v.balance * scaled
  }
  if (v.type === "SplitAbstain") {
    return (v.aye + v.nay + v.abstain) * 10n
  }
  // Split: no conviction, no abstain.
  return (v.aye + v.nay) * 10n
}

/**
 * Internal: iterate every (currency) vote entry the user holds on a
 * track. Handles both the multi-token triple-map (Enjin) and the
 * stock double-map (Polkadot / Kusama).
 */
async function getVotesAcrossCurrencies(
  api: ApiPromise,
  address: string,
  trackId: number,
): Promise<MyVoteOnPoll[]> {
  const q = voteQuery(api)
  if (!q?.votingFor) return []

  // Try the triple-map prefix first: returns one entry per currency
  // variant for (address, trackId). On a double-map runtime this
  // throws because of the arity mismatch; we fall back below.
  let entries: Array<[unknown, unknown]> | null = null
  try {
    entries = (await q.votingFor.entries(address, trackId)) as Array<
      [unknown, unknown]
    >
  } catch {
    entries = null
  }
  if (entries == null) {
    try {
      const flat = (await q.votingFor(address, trackId)) as unknown
      const votes = decodeVotes(flat, trackId)
      return votes.map((vote) => ({ vote, currencyRaw: null }))
    } catch {
      return []
    }
  }

  const out: MyVoteOnPoll[] = []
  for (const [key, value] of entries) {
    const args = (key as { args: Array<{ toJSON?: () => unknown }> }).args
    // For a 3-arg NMap the currency sits at args[2]; for a 2-arg
    // double-map there is no third key. Decode defensively.
    const currencyRaw = args[2]?.toJSON?.() ?? null
    const votes = decodeVotes(value, trackId)
    for (const v of votes) {
      out.push({ vote: v, currencyRaw })
    }
  }
  return out
}

export type Delegation = {
  trackId: number
  target: string
  balance: bigint
  conviction: Conviction
  /** Raw chain currency variant ({ Enj: null } | { SEnj: { tokenId } } | null). */
  currencyRaw: unknown
}

/**
 * Every active delegation the address holds, one per (track, currency). A
 * `votingFor` row is either `Casting` (the user votes directly) or
 * `Delegating { target, balance, conviction, … }`; we decode only the latter.
 * Used by the account page's Delegation panel to show + undo delegations.
 */
export async function getDelegationsFor(
  api: ApiPromise,
  address: string,
): Promise<Delegation[]> {
  const q = voteQuery(api)
  if (!q?.votingFor) return []

  let entries: Array<[unknown, unknown]> | null = null
  try {
    entries = (await q.votingFor.entries(address)) as Array<[unknown, unknown]>
  } catch {
    return []
  }

  const out: Delegation[] = []
  for (const [key, value] of entries) {
    const v = value as Record<string, unknown>
    if (!v?.isDelegating) continue
    const d = v.asDelegating as Record<string, unknown>
    const args = (key as {
      args: Array<{ toJSON?: () => unknown; toNumber?: () => number; toString: () => string }>
    }).args
    const trackCodec = args[1]
    const trackId = trackCodec?.toNumber?.() ?? Number(trackCodec?.toString())
    if (!Number.isFinite(trackId)) continue
    out.push({
      trackId,
      target: (d.target as { toString: () => string }).toString(),
      balance: toBigInt(d.balance),
      conviction: ((d.conviction as { type?: string })?.type ?? "None") as Conviction,
      currencyRaw: args[2]?.toJSON?.() ?? null,
    })
  }
  out.sort((a, b) => a.trackId - b.trackId)
  return out
}

export type PollVoter = {
  voter: string
  trackId: number
  vote: VoteRecord
  /**
   * Enj | { SEnj: { tokenId } }, from the multi-token `votingFor` key (or
   * voteManager.voteCurrencies). Null on stock single-currency Substrate.
   */
  currencyRaw: unknown
}

/**
 * Enumerate every voter on `pollIndex`. Reads
 * `convictionVoting.votingFor.entries()` and filters to records that
 * mention the poll - far lighter than scanning chain events, and works
 * regardless of whether the referendum is ongoing or terminal (vote
 * rows persist on chain until each voter calls `removeVote`).
 *
 * For historical voter lists pass an `apiAt` (api.at(blockHash)) so we
 * read state at the right block - this matters for terminal referenda
 * where some voters may have removed their vote after finalisation.
 *
 * Also pulls per-vote currency from `voteManager.VoteCurrencies(voter,
 * pollIndex)` when the pallet is present, so we can distinguish
 * liquid ENJ from staked-pool votes in the UI.
 */
export async function listVotesOnPoll(
  api: ApiPromise,
  pollIndex: number,
): Promise<PollVoter[]> {
  const q = voteQuery(api)
  if (!q?.votingFor) return []

  const entries = await q.votingFor.entries()
  const out: PollVoter[] = []

  for (const [key, value] of entries) {
    const args = key.args as unknown as Array<{
      toJSON?: () => unknown
      toString: () => string
      toNumber?: () => number
    }>
    const accountCodec = args[0]
    const trackCodec = args[1]
    // Triple-map (Enjin's multi-token-aware variant) has the currency
    // as the third key. Standard Substrate is a double-map without
    // it. Reading the currency straight from the key avoids a separate
    // per-row storage lookup on the voteManager path.
    const currencyCodec = args[2]
    const voter = accountCodec.toString()
    const trackId = trackCodec.toNumber?.() ?? Number(trackCodec.toString())
    const currencyFromKey = currencyCodec?.toJSON?.() ?? null
    const votes = decodeVotes(value, trackId)
    for (const v of votes) {
      if (v.pollIndex === pollIndex) {
        out.push({ voter, trackId, vote: v, currencyRaw: currencyFromKey })
      }
    }
  }

  // Enrich with currency from voteManager when available. The double-
  // map's key order varies across runtimes: some declare
  // `(AccountId, PollIndex)`, others `(PollIndex, AccountId)`. Try the
  // (voter, poll) order first, then fall back to (poll, voter) - only
  // one will return Some. Best-effort: any failure leaves the row's
  // currencyRaw at null and the UI defaults to "ENJ".
  const vm = api.query.voteManager?.voteCurrencies
  if (vm) {
    await Promise.all(
      out.map(async (row) => {
        try {
          let raw = await vm(row.voter, pollIndex)
          let parsed = raw?.toJSON?.()
          if (parsed == null) {
            raw = await vm(pollIndex, row.voter)
            parsed = raw?.toJSON?.()
          }
          if (parsed != null) row.currencyRaw = parsed
        } catch {
          // currency lookup is best-effort
        }
      }),
    )
  }

  return out
}

/**
 * Read all per-track locks for an address, in `currency` (defaults to ENJ).
 *
 * Storage shape differs by runtime: stock Substrate keys `classLocksFor` by
 * (account) alone, while Enjin's multi-token fork keys it by (account,
 * currency). Try the 2-key (multi-token) read first, then fall back to the
 * 1-key form so locks resolve on either runtime.
 */
export async function getClassLocks(
  api: ApiPromise,
  address: string,
  currency: VoteCurrency = ENJ,
): Promise<ClassLock[]> {
  const q = voteQuery(api)
  if (!q?.classLocksFor) return []
  let raw: unknown
  try {
    // Multi-token fork: (account, currency). Throws on a 1-key map.
    raw = await q.classLocksFor(address, currency)
  } catch {
    try {
      // Stock Substrate: (account).
      raw = await q.classLocksFor(address)
    } catch {
      return []
    }
  }
  const entries = raw as ReadonlyArray<readonly [unknown, unknown]>
  return entries.map(([cls, amount]) => ({
    trackId: toNumber(cls),
    amount: toBigInt(amount),
  }))
}

export type ActiveVoteLock = {
  pollIndex: number
  balance: bigint
  conviction: Conviction
  aye: boolean
}

export type TrackLock = {
  trackId: number
  /** Total balance frozen on this track (authoritative, from classLocksFor). */
  locked: bigint
  /** Residual lock left by already-removed votes: `amount` frozen until `unlockAt`. */
  prior: { unlockAt: number; amount: bigint } | null
  /** Votes still actively holding a lock - must be removed before their share frees. */
  activeVotes: ActiveVoteLock[]
  /**
   * Raw chain currency the lock is denominated in ({ Enj: null } |
   * { SEnj: { tokenId } } | null). Locks are held per currency on Enjin's
   * multi-token fork, so a 5 sENJ vote and a 1 ENJ vote on the same track
   * are two separate locks - the UI must label + unlock each in its own
   * currency. Null on stock single-currency Substrate.
   */
  currencyRaw: unknown
}

/**
 * Stable string key for a raw chain currency, so a lock's currency (from
 * `classLocksFor`) can be matched against a vote's currency (from
 * `votingFor`). "*" means "any" (stock Substrate has no currency key).
 */
function lockCurrencyKey(raw: unknown): string {
  if (raw == null) return "*"
  if (typeof raw === "string") {
    if (/^enj$/i.test(raw)) return "enj"
    // A bare "senj" string carries no pool id, so we can't claim it is pool 0.
    // Use a sentinel that matches only other id-less sENJ strings, never a
    // real "senj:<poolId>".
    if (/^senj$/i.test(raw)) return "senj:?"
    return "*"
  }
  if (typeof raw === "object") {
    const v = raw as Record<string, unknown>
    if ("Enj" in v || "enj" in v) return "enj"
    const pool = v.SEnj ?? v.sEnj ?? v.senj
    if (pool != null) {
      let inner: unknown = pool
      if (typeof pool === "object") {
        const p = pool as Record<string, unknown>
        inner = p.tokenId ?? p.token_id ?? pool
      }
      const n = typeof inner === "number" ? inner : Number(inner)
      return `senj:${Number.isFinite(n) ? n : 0}`
    }
  }
  return "*"
}

type ClassLockWithCurrency = {
  trackId: number
  amount: bigint
  currencyRaw: unknown
}

/**
 * Every conviction lock the address holds, one row per (track, currency).
 *
 * On Enjin's multi-token fork `classLocksFor` is keyed (account, currency),
 * so a single account can hold an ENJ lock AND a per-pool sENJ lock on the
 * same track. `entries(address)` prefix-iterates every currency in one shot,
 * so each currency's lock is captured. Falls back to the stock single-key
 * map (currencyRaw = null).
 */
async function getClassLocksAllCurrencies(
  api: ApiPromise,
  address: string,
): Promise<ClassLockWithCurrency[]> {
  const q = voteQuery(api)
  if (!q?.classLocksFor) return []
  try {
    const entries = (await q.classLocksFor.entries(address)) as Array<
      [unknown, unknown]
    >
    const out: ClassLockWithCurrency[] = []
    for (const [key, value] of entries) {
      const args = (key as { args: Array<{ toJSON?: () => unknown }> }).args
      const currencyRaw = args[1]?.toJSON?.() ?? null
      const locks = value as ReadonlyArray<readonly [unknown, unknown]>
      for (const [cls, amount] of locks) {
        out.push({
          trackId: toNumber(cls),
          amount: toBigInt(amount),
          currencyRaw,
        })
      }
    }
    return out
  } catch {
    // Stock Substrate single-key map: classLocksFor(account).
    try {
      const raw = (await q.classLocksFor(address)) as unknown
      const locks = raw as ReadonlyArray<readonly [unknown, unknown]>
      return locks.map(([cls, amount]) => ({
        trackId: toNumber(cls),
        amount: toBigInt(amount),
        currencyRaw: null,
      }))
    } catch {
      return []
    }
  }
}

/**
 * Per-track lock picture for an address. `classLocksFor` is the
 * authoritative frozen amount; `votingFor` supplies the unlock-at block
 * (the `prior` lock, set when a vote is removed) and the active-vote list
 * - neither of which `classLocksFor` alone can express. Combine with the
 * current block to decide what's unlockable now vs. still counting down.
 *
 * Locks are enumerated per currency, so an ENJ lock and an sENJ lock on the
 * same track surface as two rows (each unlockable in its own currency).
 */
export async function getAccountLocks(
  api: ApiPromise,
  address: string,
): Promise<TrackLock[]> {
  const q = voteQuery(api)
  if (!q?.votingFor) return []
  const classLocks = await getClassLocksAllCurrencies(api, address)
  const out: TrackLock[] = []
  for (const { trackId, amount, currencyRaw } of classLocks) {
    if (amount <= 0n) continue
    const { activeVotes, prior } = await readTrackVoting(
      api,
      address,
      trackId,
      currencyRaw,
    )
    out.push({ trackId, locked: amount, prior, activeVotes, currencyRaw })
  }
  return out
}

async function readTrackVoting(
  api: ApiPromise,
  address: string,
  trackId: number,
  currencyRaw: unknown,
): Promise<{
  activeVotes: ActiveVoteLock[]
  prior: { unlockAt: number; amount: bigint } | null
}> {
  const q = voteQuery(api)
  const want = lockCurrencyKey(currencyRaw)
  const activeVotes: ActiveVoteLock[] = []
  let prior: { unlockAt: number; amount: bigint } | null = null
  const consume = (value: unknown) => {
    const decoded = decodeCastingLock(value, trackId)
    activeVotes.push(...decoded.activeVotes)
    // Entries are already filtered to one currency, so there is normally a
    // single prior lock; keep the latest-expiring one defensively.
    if (decoded.prior && (prior == null || decoded.prior.unlockAt > prior.unlockAt)) {
      prior = decoded.prior
    }
  }
  let entries: Array<[unknown, unknown]> | null = null
  try {
    entries = (await q.votingFor.entries(address, trackId)) as Array<[unknown, unknown]>
  } catch {
    entries = null
  }
  if (entries != null) {
    for (const [key, value] of entries) {
      // Only fold in the votingFor row for the SAME currency as this lock,
      // so an ENJ lock's "held by" list doesn't claim an sENJ vote (and
      // vice-versa). "*" (stock Substrate) matches everything.
      const entryCurrency =
        (key as { args: Array<{ toJSON?: () => unknown }> }).args[2]?.toJSON?.() ??
        null
      if (want !== "*" && lockCurrencyKey(entryCurrency) !== want) continue
      consume(value)
    }
  } else {
    try {
      consume(await q.votingFor(address, trackId))
    } catch {
      // no voting state for this track
    }
  }
  return { activeVotes, prior }
}

function decodeCastingLock(
  raw: unknown,
  trackId: number,
): {
  activeVotes: ActiveVoteLock[]
  prior: { unlockAt: number; amount: bigint } | null
} {
  const v = raw as Record<string, unknown>
  if (v?.isCasting) {
    const casting = v.asCasting as Record<string, unknown>
    const activeVotes = decodeVotes(raw, trackId).map<ActiveVoteLock>((rec) =>
      rec.type === "Standard"
        ? {
            pollIndex: rec.pollIndex,
            balance: rec.balance,
            conviction: rec.conviction,
            aye: rec.aye,
          }
        : {
            pollIndex: rec.pollIndex,
            balance:
              rec.type === "SplitAbstain"
                ? rec.aye + rec.nay + rec.abstain
                : rec.aye + rec.nay,
            conviction: "None",
            aye: rec.type === "Split" ? rec.aye >= rec.nay : false,
          },
    )
    return { activeVotes, prior: decodePrior(casting.prior) }
  }
  if (v?.isDelegating) {
    const del = v.asDelegating as Record<string, unknown>
    return { activeVotes: [], prior: decodePrior(del.prior) }
  }
  return { activeVotes: [], prior: null }
}

/** `PriorLock(BlockNumber, Balance)` decodes as a 2-tuple codec. */
function decodePrior(priorRaw: unknown): { unlockAt: number; amount: bigint } | null {
  if (priorRaw == null) return null
  const tuple = priorRaw as ArrayLike<unknown>
  const amount = toBigInt(tuple[1])
  if (amount <= 0n) return null
  return { unlockAt: toNumber(tuple[0]), amount }
}

function decodeVotes(raw: unknown, trackId: number): VoteRecord[] {
  const v = raw as Record<string, unknown>
  if (!v.isCasting) return []
  const casting = v.asCasting as Record<string, unknown>
  const votes =
    (casting.votes as unknown as ReadonlyArray<readonly [unknown, unknown]>) ?? []

  return votes.map(([pollIndexCodec, accountVote]) => {
    const pollIndex = toNumber(pollIndexCodec)
    const av = accountVote as Record<string, unknown>

    if (av.isStandard) {
      const inner = av.asStandard as Record<string, unknown>
      const voteFlag = inner.vote as Record<string, unknown>
      const aye = Boolean((voteFlag.isAye as boolean | undefined) ?? false)
      const conviction = (voteFlag.conviction as { type: string }).type as Conviction
      return {
        type: "Standard" as const,
        pollIndex,
        trackId,
        aye,
        balance: toBigInt(inner.balance),
        conviction,
      }
    }
    if (av.isSplit) {
      const inner = av.asSplit as Record<string, unknown>
      return {
        type: "Split" as const,
        pollIndex,
        trackId,
        aye: toBigInt(inner.aye),
        nay: toBigInt(inner.nay),
      }
    }
    const inner = av.asSplitAbstain as Record<string, unknown>
    return {
      type: "SplitAbstain" as const,
      pollIndex,
      trackId,
      aye: toBigInt(inner.aye),
      nay: toBigInt(inner.nay),
      abstain: toBigInt(inner.abstain),
    }
  })
}

function toNumber(x: unknown): number {
  if (x == null) return 0
  const v = x as { toNumber?: () => number }
  return typeof v.toNumber === "function" ? v.toNumber() : Number(x)
}

function toBigInt(x: unknown): bigint {
  if (x == null) return 0n
  const v = x as { toBigInt?: () => bigint; toString: () => string }
  return typeof v.toBigInt === "function" ? v.toBigInt() : BigInt(v.toString())
}

/**
 * Treasury spend helpers.
 *
 * - `buildSpendLocalCall` composes the call to enact (NOT an extrinsic -
 *   it gets wrapped by preimage.notePreimage + referenda.submit).
 * - `pickOriginForAmount` selects the smallest treasury track that covers
 *   the requested amount. Pure function over a TreasuryTier table so we
 *   can test it without hitting a chain.
 * - `treasuryTiersForSpec` picks that table for the connected runtime from
 *   `ENJIN_SPEND_LIMITS`, the runtime's `SpendOrigin` limits per spec version.
 *
 * Origins are validated against the deployed Enjin Relay runtime (specs 1070
 * and 1080): the `Origins` enum exposes SmallTipper / BigTipper / SmallSpender /
 * MediumSpender / BigSpender / TreasuryAdmin. TreasuryAdmin fills the role of
 * Polkadot's `Treasurer` (largest spend origin, also the treasury
 * `RejectOrigin`); there is no origin literally named `Treasurer`, so
 * `{ Origins: 'Treasurer' }` can't even be encoded. We cap at TreasuryAdmin's
 * limit and reject larger requests rather than file a referendum that can't
 * enact.
 */

import type { ApiPromise } from "@polkadot/api"
import type { Call } from "@polkadot/types/interfaces"
import type { TreasuryTier } from "./types"

const ENJ = 10n ** 18n

/** One runtime's treasury spend limits. */
export type SpendLimits = {
  specVersion: number
  /** Treasury origins, smallest → largest spend authority. */
  tiers: readonly TreasuryTier[]
}

/**
 * The Enjin Relay runtime's `Spender` EnsureOrigin limits (relaychain
 * `runtime/common/src/governance/origins.rs`, the treasury's `SpendOrigin`),
 * oldest spec first. `spend_local` fails with `InsufficientPermission` at
 * enactment - after the full vote - when the amount exceeds the origin's
 * limit. The limits are not exposed in metadata/consts, so they are copied
 * here from each release. The enjin and canary runtimes both take `Spender`
 * from runtime/common, so one table per spec covers both networks.
 *
 * Every tier is bounded - there is NO unbounded catch-all. TreasuryAdmin is
 * the top tier; a request above it has no covering tier, so
 * `pickOriginForAmount` returns null and the create flow rejects it (rather
 * than filing a referendum under an origin that can't authorize it).
 *
 * When a runtime upgrade changes `Spender`, add its spec version here before
 * the upgrade is applied: `treasuryTiersForSpec` holds a chain to the lowest
 * of its own and every later listed limit, so referenda filed before the
 * upgrade still enact after it.
 */
export const ENJIN_SPEND_LIMITS: readonly SpendLimits[] = [
  {
    // relaychain v1.7.0
    specVersion: 1070,
    tiers: [
      { origin: "SmallTipper", maxAmount: 100n * ENJ },
      { origin: "BigTipper", maxAmount: 5_000n * ENJ },
      { origin: "SmallSpender", maxAmount: 50_000n * ENJ },
      { origin: "MediumSpender", maxAmount: 250_000n * ENJ },
      { origin: "BigSpender", maxAmount: 2_500_000n * ENJ },
      { origin: "TreasuryAdmin", maxAmount: 25_000_000n * ENJ },
    ],
  },
  {
    // relaychain v1.8.0 - raises SmallTipper and BigTipper
    specVersion: 1080,
    tiers: [
      { origin: "SmallTipper", maxAmount: 2_500n * ENJ },
      { origin: "BigTipper", maxAmount: 10_000n * ENJ },
      { origin: "SmallSpender", maxAmount: 50_000n * ENJ },
      { origin: "MediumSpender", maxAmount: 250_000n * ENJ },
      { origin: "BigSpender", maxAmount: 2_500_000n * ENJ },
      { origin: "TreasuryAdmin", maxAmount: 25_000_000n * ENJ },
    ],
  },
]

/** The treasury spend origins, smallest → largest spend authority. */
export const TREASURY_SPEND_ORIGINS: readonly string[] = ENJIN_SPEND_LIMITS[0].tiers.map(
  (t) => t.origin,
)

/** The tier table `treasuryTiersForSpec` picked for a runtime. */
export type TreasuryTierTable = {
  /** Tiers to file under, smallest first. */
  tiers: readonly TreasuryTier[]
  /** The listed spec the limits come from (the chain's own when listed). */
  limitsSpecVersion: number
  /** False when the chain runs a spec missing from the limits list. */
  verified: boolean
}

const tierTableCache = new WeakMap<readonly SpendLimits[], Map<number, TreasuryTierTable | null>>()

/**
 * The tier table for a chain running `specVersion`. It starts from the newest
 * listed spec at or below `specVersion` and holds each origin to the lowest
 * limit across that spec and every later listed one, so a referendum filed
 * now still enacts if a listed upgrade lands before it does.
 *
 * A spec missing from the list (newer than every entry, or between two) gets
 * `verified: false`: its upgrade may have lowered a limit, so callers should
 * warn. A spec older than every entry returns null - its limits are unknown,
 * so callers must not file a spend. Results are cached per spec, so the tiers
 * keep a stable identity across renders.
 */
export function treasuryTiersForSpec(
  specVersion: number,
  limits: readonly SpendLimits[] = ENJIN_SPEND_LIMITS,
): TreasuryTierTable | null {
  let cache = tierTableCache.get(limits)
  if (!cache) {
    cache = new Map()
    tierTableCache.set(limits, cache)
  }
  const cached = cache.get(specVersion)
  if (cached !== undefined) return cached

  let baseIdx = -1
  limits.forEach((l, i) => {
    if (l.specVersion <= specVersion) baseIdx = i
  })
  let table: TreasuryTierTable | null = null
  if (baseIdx >= 0) {
    const base = limits[baseIdx]
    const later = limits.slice(baseIdx + 1)
    table = {
      tiers: base.tiers.map((tier) => ({
        origin: tier.origin,
        maxAmount: later.reduce((cap, l) => {
          // Every table lists the same origins (see the treasury tests).
          const next = l.tiers.find((t) => t.origin === tier.origin)
          return next ? lowerCap(cap, next.maxAmount) : cap
        }, tier.maxAmount),
      })),
      limitsSpecVersion: base.specVersion,
      verified: base.specVersion === specVersion,
    }
  }
  cache.set(specVersion, table)
  return table
}

/** The lower of two caps, where null is unbounded. */
function lowerCap(a: bigint | null, b: bigint | null): bigint | null {
  if (a === null) return b
  if (b === null) return a
  return a < b ? a : b
}

/** Largest spend any tier can authorize, or null if some tier is unbounded. */
export function maxTreasurySpend(tiers: readonly TreasuryTier[]): bigint | null {
  let max = 0n
  for (const tier of tiers) {
    if (tier.maxAmount === null) return null
    if (tier.maxAmount > max) max = tier.maxAmount
  }
  return max
}

/**
 * Pick the smallest treasury tier whose maxAmount accommodates `amount`.
 * Returns null when the amount exceeds every tier's cap (i.e. above the top
 * tier, TreasuryAdmin) or is negative - callers must treat a null as "too
 * large to submit", not pick a fallback origin.
 */
export function pickOriginForAmount(
  amount: bigint,
  tiers: readonly TreasuryTier[],
): TreasuryTier | null {
  if (amount < 0n) return null
  for (const tier of tiers) {
    if (tier.maxAmount === null || amount <= tier.maxAmount) return tier
  }
  return null
}

/**
 * Re-check at submit time that the chosen tier can actually authorize the
 * spend. `pickOriginForAmount` already selects a covering tier, but callers
 * can pass an explicit `tier`, and the `ENJIN_SPEND_LIMITS` caps are NOT
 * read back from the runtime's `SpendOrigin` config - Substrate does not
 * expose those per-origin limits in metadata/consts, so we cannot derive
 * them from chain state. This guard at least stops us from filing a
 * referendum under an origin our own table says is too small to authorize
 * the amount: that would otherwise pass the full vote cycle and only then
 * abort at enactment (`spend_local`), after the deposits are spent. Throws
 * a descriptive error rather than building an un-authorizable submission.
 */
export function assertTierCoversAmount(tier: TreasuryTier, amount: bigint): void {
  if (tier.maxAmount !== null && amount > tier.maxAmount) {
    throw new Error(
      `Treasury tier "${tier.origin}" authorizes at most ${tier.maxAmount} planck, ` +
        `but the requested spend is ${amount} planck. Select a higher tier ` +
        `(pickOriginForAmount) before submitting.`,
    )
  }
}

export type SpendLocalParams = {
  amount: bigint
  beneficiary: string
}

/**
 * Build a `treasury.spendLocal(amount, beneficiary)` Call (not an extrinsic).
 *
 * For Relaychain-internal spends - the beneficiary is paid in the relay's
 * native token from the relay treasury account.
 */
export function buildSpendLocalCall(api: ApiPromise, params: SpendLocalParams): Call {
  return api.tx.treasury.spendLocal(
    params.amount.toString(),
    params.beneficiary,
  ).method as Call
}

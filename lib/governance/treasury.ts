/**
 * Treasury spend helpers.
 *
 * - `buildSpendLocalCall` composes the call to enact (NOT an extrinsic -
 *   it gets wrapped by preimage.notePreimage + referenda.submit).
 * - `pickOriginForAmount` selects the smallest treasury track that covers
 *   the requested amount. Pure function over a TreasuryTier table so we
 *   can test it without hitting a chain.
 *
 * The tier amounts below mirror Polkadot's ratios scaled to ENJ. Callers
 * can pass an explicit tier table (e.g. derived from
 * `api.consts.referenda.tracks`) to match a specific runtime.
 *
 * Origins are validated against the deployed Enjin Relay runtime (enjin
 * v1070): the `Origins` enum exposes SmallTipper / BigTipper / SmallSpender /
 * MediumSpender / BigSpender. There is NO `Treasurer` spend origin on Enjin
 * (unlike Polkadot), so BigSpender is the largest treasury-by-referendum
 * origin. Filing under a non-existent origin like `{ Origins: 'Treasurer' }`
 * can't even be encoded. We deliberately cap at BigSpender / 1,000,000 ENJ and
 * reject larger requests rather than file a referendum that can't enact.
 */

import type { ApiPromise } from "@polkadot/api"
import type { Call } from "@polkadot/types/interfaces"
import type { TreasuryTier } from "./types"

/**
 * Treasury origins on Enjin Relay, ordered smallest → largest spend authority.
 * Every tier is bounded - there is NO unbounded catch-all. BigSpender is the
 * top tier and we cap it at 1,000,000 ENJ; a request above that has no covering
 * tier, so `pickOriginForAmount` returns null and the create flow rejects it
 * (rather than filing a referendum under an origin that can't authorize it).
 *
 * Amounts mirror Polkadot's tier ratios scaled to ENJ; pass a custom tier
 * table to `pickOriginForAmount` to match a specific runtime's track config.
 *
 * NOTE: BigSpender's exact on-chain SpendOrigin cap is not exposed in
 * metadata/consts. 1,000,000 ENJ is a deliberate product cap, not a value read
 * from chain (a 150k ENJ spend has enacted under BigSpender, so the true cap is
 * ≥150k). Confirm against the runtime source before raising it.
 */
export const ENJIN_TREASURY_TIERS: readonly TreasuryTier[] = [
  { origin: "SmallTipper", maxAmount: 250n * 10n ** 18n },
  { origin: "BigTipper", maxAmount: 1_000n * 10n ** 18n },
  { origin: "SmallSpender", maxAmount: 10_000n * 10n ** 18n },
  { origin: "MediumSpender", maxAmount: 100_000n * 10n ** 18n },
  { origin: "BigSpender", maxAmount: 1_000_000n * 10n ** 18n },
] as const

/** Largest spend any tier can authorize, or null if some tier is unbounded. */
export function maxTreasurySpend(
  tiers: readonly TreasuryTier[] = ENJIN_TREASURY_TIERS,
): bigint | null {
  let max = 0n
  for (const tier of tiers) {
    if (tier.maxAmount === null) return null
    if (tier.maxAmount > max) max = tier.maxAmount
  }
  return max
}

/**
 * Pick the smallest treasury tier whose maxAmount accommodates `amount`.
 * Returns null when the amount exceeds every tier's cap (i.e. above the
 * BigSpender / 1,000,000 ENJ ceiling) or is negative - callers must treat a
 * null as "too large to submit", not pick a fallback origin.
 */
export function pickOriginForAmount(
  amount: bigint,
  tiers: readonly TreasuryTier[] = ENJIN_TREASURY_TIERS,
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
 * can pass an explicit `tier`, and the `ENJIN_TREASURY_TIERS` caps are NOT
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

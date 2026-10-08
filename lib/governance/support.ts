/**
 * The issuance a referendum's support is measured against.
 *
 * Support is `tally.support / MaxTurnout`, and which issuance the runtime
 * uses as `MaxTurnout` changed between Enjin Relay releases:
 *
 *   - spec 1070 and older: ACTIVE issuance, `totalIssuance - inactiveIssuance`
 *     (Polkadot's `ActiveIssuanceOf`). On mainnet about 575M of the 2,029M ENJ
 *     is inactive, so dividing by the total understates support by ~28%:
 *     referendum #15 started confirming at 33.9% of active issuance (24.3% of
 *     total) against a 32.3% requirement (verified on a Chopsticks fork).
 *   - spec 1080 and newer: TOTAL issuance.
 *
 * Pure functions only; `useSupportIssuance` reads the inputs from the chain.
 */

/** First Enjin Relay spec whose referenda measure support against total issuance. */
export const TOTAL_ISSUANCE_SUPPORT_SPEC = 1080

/** Which issuance the connected runtime divides support by. */
export type SupportBasis = "active" | "total"

export function supportBasisForSpec(specVersion: number): SupportBasis {
  return specVersion >= TOTAL_ISSUANCE_SUPPORT_SPEC ? "total" : "active"
}

/**
 * The denominator of the support percentage on a runtime at `specVersion`:
 * total issuance from spec 1080, total minus inactive issuance before it.
 * Never negative.
 */
export function supportDenominator(
  specVersion: number,
  totalIssuance: bigint,
  inactiveIssuance: bigint,
): bigint {
  if (supportBasisForSpec(specVersion) === "total") return totalIssuance
  const active = totalIssuance - inactiveIssuance
  return active > 0n ? active : 0n
}

/** Support as a fraction (0..1, float) of the runtime's denominator; null when it is zero. */
export function supportFraction(support: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null
  return Number((support * 1_000_000_000n) / denominator) / 1_000_000_000
}

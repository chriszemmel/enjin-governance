/**
 * Pure evaluators for the OpenGov approval/support requirement curves.
 *
 * A referendum's track defines two curves - `minApproval` and `minSupport`
 * (decoded in tracks.ts) - that give the *required* threshold as a function
 * of how far the referendum is through its decision period. Both requirements
 * decay over time: a proposal needs overwhelming support on day one and less
 * as the clock runs down.
 *
 * The formulas mirror Substrate's `pallet_referenda::Curve::threshold`. The
 * input `x` is the fraction of the decision period elapsed (0 = just entered
 * deciding, 1 = decision period exhausted); the output is the required
 * threshold as a fraction in [0, 1].
 *
 * Perbill-encoded fields (length/floor/ceil/begin/end/step/period) are raw
 * integers in [0, 1e9]. Reciprocal's FixedI64 fields (factor/xOffset/yOffset)
 * are 1e9-scaled bigints and may be negative.
 */

import type { GovernanceCurve } from "./types"

const PERBILL = 1_000_000_000
const FIXED_I64 = 1_000_000_000

/** Required threshold (0..1) at elapsed-fraction `x` (0..1). */
export function evaluateCurve(curve: GovernanceCurve, x: number): number {
  const t = clamp01(x)
  switch (curve.type) {
    case "LinearDecreasing": {
      const length = curve.length / PERBILL
      const floor = curve.floor / PERBILL
      const ceil = curve.ceil / PERBILL
      // Degenerate zero-length curve: the floor holds for the whole period.
      if (length <= 0) return clamp01(floor)
      const frac = Math.min(t, length) / length
      return clamp01(ceil - frac * (ceil - floor))
    }
    case "SteppedDecreasing": {
      const begin = curve.begin / PERBILL
      const end = curve.end / PERBILL
      const step = curve.step / PERBILL
      const period = curve.period / PERBILL
      if (period <= 0) return clamp01(Math.max(end, begin))
      const drop = step * Math.floor(t / period)
      return clamp01(Math.max(end, begin - Math.min(begin, drop)))
    }
    case "Reciprocal": {
      const factor = Number(curve.factor) / FIXED_I64
      const xOffset = Number(curve.xOffset) / FIXED_I64
      const yOffset = Number(curve.yOffset) / FIXED_I64
      const denom = t + xOffset
      // A zero denominator means the asymptote - the curve saturates.
      if (denom === 0) return 1
      return clamp01(factor / denom + yOffset)
    }
  }
}

/**
 * Sample a curve at `points + 1` evenly-spaced x values across [0, 1].
 * Returned as `{ x, y }` pairs, ready to map into chart coordinates.
 */
export function sampleCurve(
  curve: GovernanceCurve,
  points = 100,
): Array<{ x: number; y: number }> {
  const n = Math.max(1, Math.floor(points))
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= n; i++) {
    const x = i / n
    out.push({ x, y: evaluateCurve(curve, x) })
  }
  return out
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

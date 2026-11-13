/**
 * Where an ongoing referendum stands against its track's requirements, and
 * when it would pass if the votes stay as they are.
 *
 * Mirrors `pallet_referenda::service_referendum`:
 *
 *   - Without a decision deposit nothing counts down, and the referendum times
 *     out at `submitted + undecidingTimeout`.
 *   - With a deposit, deciding starts once the prepare period is over and the
 *     track has a free deciding slot; otherwise it waits in the track's queue.
 *   - While deciding, it is passing when approval and support both meet their
 *     curves at `x = elapsed / decisionPeriod` (capped at 1). Passing starts the
 *     confirm period; it passes once it is still passing at its end, which may
 *     run past the decision period. Not passing at or after the decision
 *     period's end rejects it.
 *   - The chain re-checks a referendum the block after any vote, and sets an
 *     alarm for the block where today's votes meet both curves:
 *     `since + ceil(max(delay(approval), delay(support)) * decisionPeriod)`.
 *     So "on track" (passing, not yet confirming) lasts about one block.
 *
 * Both curves only fall, so votes that meet them at the end of the decision
 * period (x = 1) meet them before or at it, and never otherwise. Approval and
 * support are compared as the chain rounds them (Perbill, rounded down).
 */

import { evaluateCurve } from "./curves"
import type { GovernanceCurve, OngoingStatus, Tally, Track } from "./types"

const PERBILL = 1_000_000_000n

export type VerdictKind =
  /** No decision deposit yet: nothing counts down. */
  | "needs-deposit"
  /** Deposit placed, prepare period still running. */
  | "preparing"
  /** Ready to decide, waiting for a free deciding slot on the track. */
  | "queued"
  /** Deciding, no votes at all yet. */
  | "no-votes"
  /** Meets both curves today; the chain starts confirming at its next check. */
  | "on-track"
  /** Below today's requirement, but today's votes meet both curves before the decision period ends. */
  | "on-course"
  /** Today's votes can't meet the curves by the end of the decision period. */
  | "short"
  /** Confirming and still meeting both curves. */
  | "confirming"
  /** Confirming, but no longer meets the curves: the next check stops it (or rejects it, past the decision period). */
  | "slipping"

export type Verdict = {
  kind: VerdictKind
  /** Approval as the chain counts it: ayes / (ayes + nays), 0 with no votes. */
  approval: number
  /** Support as a fraction of the runtime's denominator. */
  support: number
  approvalNeededNow: number | null
  supportNeededNow: number | null
  approvalNeededAtEnd: number
  supportNeededAtEnd: number
  /** Support (planck) the referendum needs at the end of the decision period. */
  supportFloor: bigint
  /** Support (planck) still missing to reach `supportFloor`; 0 when it's there. */
  supportMissing: bigint
  approvalShort: boolean
  supportShort: boolean
  /** Block where deciding starts or started; null while it can't be known. */
  decidingSince: number | null
  /** Last block of the decision period, once deciding. */
  decisionEnd: number | null
  /** Block where today's votes first meet both curves (on-course). */
  meetsCurvesAt: number | null
  /** Block the referendum passes if votes hold: end of confirming. */
  passesAt: number | null
  /** Block a referendum without a decision deposit times out. */
  timeoutAt: number | null
  /** Start of the decision period once the prepare period ends (preparing). */
  prepareEnd: number | null
  confirmPeriod: number
}

/** `Perbill::from_rational(p, q)` rounded down, in parts per billion. */
export function perbillParts(p: bigint, q: bigint): bigint {
  if (q <= 0n || p > q) return PERBILL
  return (p * PERBILL) / q
}

/** `Perbill::from_rational(p, q)` with the chain's rounding (down), as a float. */
export function perbill(p: bigint, q: bigint): number {
  if (q <= 0n) return 0
  return Number(perbillParts(p, q)) / 1e9
}

/** Approval as `pallet_conviction_voting::Tally::approval`: zero without votes. */
export function approvalOf(tally: Tally): number {
  const total = tally.ayes + tally.nays
  return total === 0n ? 0 : perbill(tally.ayes, total)
}

function approvalParts(tally: Tally): bigint {
  const total = tally.ayes + tally.nays
  return total === 0n ? 0n : perbillParts(tally.ayes, total)
}

/**
 * `pallet_referenda::Curve::threshold` in exact integer arithmetic: the
 * required Perbill (parts per billion) at `x` parts per billion of the
 * decision period, rounded the way the runtime rounds.
 */
export function thresholdParts(curve: GovernanceCurve, x: bigint): bigint {
  switch (curve.type) {
    case "LinearDecreasing": {
      const length = BigInt(curve.length)
      const ceil = BigInt(curve.ceil)
      const floor = BigInt(curve.floor)
      const xm = x < length ? x : length
      const ratio = length === 0n ? PERBILL : perbillParts(xm, length)
      return ceil - (ratio * (ceil - floor)) / PERBILL
    }
    case "SteppedDecreasing": {
      const begin = BigInt(curve.begin)
      const end = BigInt(curve.end)
      const step = BigInt(curve.step)
      const period = BigInt(curve.period)
      const steps = period === 0n ? 0n : x / period
      let drop = step * steps
      if (drop > PERBILL) drop = PERBILL
      const v = begin - (drop < begin ? drop : begin)
      return v > end ? v : end
    }
    case "Reciprocal": {
      // FixedI64 has 9 decimals, so its raw value is in parts per billion too.
      const denom = x + curve.xOffset
      if (denom === 0n) return PERBILL
      const negative = curve.factor < 0n !== denom < 0n
      const num = (curve.factor < 0n ? -curve.factor : curve.factor) * PERBILL
      const den = denom < 0n ? -denom : denom
      // Rounding::Low: toward negative infinity.
      const q = num / den
      const yp = negative ? -(num % den === 0n ? q : q + 1n) : q
      const y = yp + curve.yOffset
      return y < 0n ? 0n : y > PERBILL ? PERBILL : y
    }
  }
}

/** The decision period's elapsed share as the runtime computes it. */
function elapsedParts(elapsed: number, period: number): bigint {
  if (period <= 0) return PERBILL
  return perbillParts(BigInt(Math.min(Math.max(elapsed, 0), period)), BigInt(period))
}

function passingAt(track: Track, approval: bigint, support: bigint, x: bigint): boolean {
  return (
    approval >= thresholdParts(track.minApproval, x) &&
    support >= thresholdParts(track.minSupport, x)
  )
}

/**
 * Earliest x in [from, 1] where `curve(x) <= y` (floats, for charts), or null
 * if it never is. The curves only fall, so bisection works for every shape.
 */
export function firstPassingX(curve: GovernanceCurve, y: number, from = 0): number | null {
  const lo0 = Math.min(Math.max(from, 0), 1)
  if (y >= evaluateCurve(curve, lo0)) return lo0
  if (y < evaluateCurve(curve, 1)) return null
  let lo = lo0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (y >= evaluateCurve(curve, mid)) hi = mid
    else lo = mid
  }
  return hi
}

/** Planck needed for `parts` per billion of `denominator`, rounded up. */
function planckFor(parts: bigint, denominator: bigint): bigint {
  return (parts * denominator + PERBILL - 1n) / PERBILL
}

export function computeVerdict(input: {
  status: OngoingStatus
  track: Track
  tally: Tally
  currentBlock: number
  /** `tally.support` is divided by this (see support.ts). */
  supportDenominator: bigint
  /** `api.consts.referenda.undecidingTimeout`, if known. */
  undecidingTimeout?: number | null
}): Verdict {
  const { status, track, tally, currentBlock, supportDenominator } = input
  const approvalP = approvalParts(tally)
  const supportP = perbillParts(tally.support, supportDenominator)
  const approval = Number(approvalP) / 1e9
  const support = supportDenominator > 0n ? Number(supportP) / 1e9 : 0
  const approvalEndP = thresholdParts(track.minApproval, PERBILL)
  const supportEndP = thresholdParts(track.minSupport, PERBILL)
  const approvalNeededAtEnd = Number(approvalEndP) / 1e9
  const supportNeededAtEnd = Number(supportEndP) / 1e9
  const supportFloor = planckFor(supportEndP, supportDenominator)
  const approvalShort = approvalP < approvalEndP
  const supportShort = supportP < supportEndP

  const base: Verdict = {
    kind: "needs-deposit",
    approval,
    support,
    approvalNeededNow: null,
    supportNeededNow: null,
    approvalNeededAtEnd,
    supportNeededAtEnd,
    supportFloor,
    supportMissing: tally.support >= supportFloor ? 0n : supportFloor - tally.support,
    approvalShort,
    supportShort,
    decidingSince: null,
    decisionEnd: null,
    meetsCurvesAt: null,
    passesAt: null,
    timeoutAt: null,
    prepareEnd: null,
    confirmPeriod: track.confirmPeriod,
  }

  const deciding = status.deciding
  if (!deciding) {
    if (status.inQueue) return { ...base, kind: "queued" }
    if (!status.decisionDeposit) {
      const timeout = input.undecidingTimeout
      return {
        ...base,
        kind: "needs-deposit",
        timeoutAt: timeout != null ? status.submitted + timeout : null,
      }
    }
    return { ...base, kind: "preparing", prepareEnd: status.submitted + track.preparePeriod }
  }

  const period = track.decisionPeriod
  const xNow = elapsedParts(currentBlock - deciding.since, period)
  const approvalNeededNow = Number(thresholdParts(track.minApproval, xNow)) / 1e9
  const supportNeededNow = Number(thresholdParts(track.minSupport, xNow)) / 1e9
  const passingNow = passingAt(track, approvalP, supportP, xNow)
  const decided: Verdict = {
    ...base,
    approvalNeededNow,
    supportNeededNow,
    decidingSince: deciding.since,
    decisionEnd: deciding.since + period,
  }

  if (deciding.confirming != null) {
    return {
      ...decided,
      kind: passingNow ? "confirming" : "slipping",
      passesAt: passingNow ? deciding.confirming : null,
    }
  }
  if (passingNow) {
    return {
      ...decided,
      kind: "on-track",
      passesAt: Math.max(currentBlock + 1, deciding.since) + track.confirmPeriod,
    }
  }
  if (tally.ayes === 0n && tally.nays === 0n && tally.support === 0n) {
    return { ...decided, kind: "no-votes" }
  }
  const end = deciding.since + period
  if (approvalShort || supportShort || currentBlock >= end) {
    return { ...decided, kind: "short" }
  }
  // First block where today's votes meet both curves: they only fall, so
  // bisect over the blocks left in the decision period.
  let lo = Math.max(currentBlock, deciding.since)
  let hi = end
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (passingAt(track, approvalP, supportP, elapsedParts(mid - deciding.since, period))) hi = mid
    else lo = mid + 1
  }
  const meetsCurvesAt = Math.max(lo, currentBlock + 1)
  return {
    ...decided,
    kind: "on-course",
    meetsCurvesAt,
    passesAt: meetsCurvesAt + track.confirmPeriod,
  }
}

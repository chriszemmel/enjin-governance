/**
 * Words for the decision verdict: the chip, the line under it and the card
 * a tap on the chip opens. Pure, so every state's copy is unit-tested;
 * dates, amounts and percentages come in as formatters.
 */

import type { Verdict } from "./verdict"

export type VerdictTone = "idle" | "course" | "pass" | "short"

export type VerdictCopy = {
  tone: VerdictTone
  label: string
  /** One line under the chip. */
  sub: string | null
  /** The explanation behind the chip. */
  body: string
  /** A second, quieter paragraph. */
  note: string | null
}

export type VerdictFormat = {
  /** Block → "Nov 18, 22:20 UTC". */
  when: (block: number) => string
  /** Block → "Nov 18". */
  day: (block: number) => string
  /** Planck → "1,019,314 ENJ". */
  amount: (planck: bigint) => string
  /** Fraction → "0.05%". */
  pct: (fraction: number) => string
  /** What support is a share of, e.g. "of total issuance". */
  ofIssuance?: string
  /** Planck the decision deposit costs on this track. */
  decisionDeposit: bigint
  /** Deciding slots on this track. */
  maxDeciding: number
}

/** Blocks → "12 hours", "1 day", "10 minutes" (6 s blocks). */
export function durationWords(blocks: number, blockTimeMs = 6_000): string {
  const minutes = Math.round((blocks * blockTimeMs) / 60_000)
  if (minutes < 60) return plural(minutes, "minute")
  const hours = minutes / 60
  if (hours < 24)
    return Number.isInteger(hours) ? plural(hours, "hour") : `${hours.toFixed(1)} hours`
  const days = hours / 24
  return Number.isInteger(days) ? plural(days, "day") : `${days.toFixed(1)} days`
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`
}

export function verdictCopy(v: Verdict, f: VerdictFormat, currentBlock: number): VerdictCopy {
  const confirm = durationWords(v.confirmPeriod)
  const floor = f.amount(v.supportFloor)
  const ended = v.decisionEnd != null && currentBlock >= v.decisionEnd

  switch (v.kind) {
    case "needs-deposit":
      return {
        tone: "idle",
        label: "Not deciding yet",
        sub:
          v.timeoutAt != null
            ? `Needs a decision deposit by ${f.day(v.timeoutAt)}`
            : "Needs a decision deposit",
        body: `Voting is open, but the decision period only starts once someone places the decision deposit of ${f.amount(f.decisionDeposit)}. Until then the requirements don't count down.`,
        note:
          v.timeoutAt != null
            ? `Without a deposit it times out around ${f.when(v.timeoutAt)}. Anyone can place it and gets it back when the referendum ends.`
            : "Anyone can place it and gets it back when the referendum ends.",
      }
    case "preparing":
      return {
        tone: "idle",
        label: "Preparing",
        sub: v.prepareEnd != null ? `Decision starts around ${f.when(v.prepareEnd)}` : null,
        body: "The decision deposit is in. The decision period starts once the track's prepare period is over, if a decision slot is free.",
        note: null,
      }
    case "queued":
      return {
        tone: "idle",
        label: "Queued",
        sub: "Waiting for a decision slot",
        body: `It's ready to be decided, but all ${f.maxDeciding} decision slots on this track are taken. It starts as soon as one frees up. Referenda with more aye votes go first.`,
        note: null,
      }
    case "no-votes":
      return {
        tone: "idle",
        label: "No votes yet",
        sub: v.decisionEnd != null ? `Decision period ends ${f.day(v.decisionEnd)}` : null,
        body: `The decision period is running. To pass by ${v.decisionEnd != null ? f.when(v.decisionEnd) : "its end"} it needs at least ${f.pct(v.approvalNeededAtEnd)} aye and ${floor} of support.`,
        note: "Aye and abstain votes count toward support, without conviction. Nay votes don't.",
      }
    case "on-track":
      return {
        tone: "pass",
        label: "On track",
        sub: "Starts confirming at the next check",
        body: `It meets both requirements today. The chain starts confirming at its next check, usually in the next block, and it passes if it still meets them ${confirm} later.`,
        note: null,
      }
    case "on-course":
      return {
        tone: "course",
        label: "On course",
        sub: v.passesAt != null ? `Passes around ${f.day(v.passesAt)} if votes hold` : null,
        body: `It's below today's requirement, but the requirement keeps dropping. If the votes stay as they are, it meets both around ${f.when(v.meetsCurvesAt!)}, confirms for ${confirm} and passes around ${f.when(v.passesAt!)}.`,
        note: `More aye or abstain votes make it pass sooner. With less than ${floor} of support it can't pass.`,
      }
    case "confirming":
      return {
        tone: "course",
        label: "Confirming",
        sub: v.passesAt != null ? `Passes around ${f.when(v.passesAt)} if it holds` : null,
        body: `It meets both requirements and is confirming. If it still does around ${f.when(v.passesAt!)}, it passes.`,
        note: ended
          ? "The decision period is over, so dropping below the requirement now rejects it."
          : "If it drops below the requirement before then, confirming stops and it has to qualify again.",
      }
    case "slipping":
      return {
        tone: "short",
        label: "Below the requirement",
        sub: ended ? "Rejected at the next check" : "Confirming stops at the next check",
        body: ended
          ? "It was confirming but no longer meets the requirements. The decision period is over, so the chain rejects it at its next check."
          : "It was confirming but no longer meets the requirements. The chain stops confirming at its next check. It can still qualify again before the decision period ends.",
        note: null,
      }
    case "short": {
      const by = v.decisionEnd != null ? f.when(v.decisionEnd) : "the end"
      if (ended) {
        return {
          tone: "short",
          label: v.approvalShort ? "Short on approval" : "Short on support",
          sub: "Rejected at the next check",
          body: "The decision period is over and it doesn't meet the requirements. The chain rejects it at its next check.",
          note: null,
        }
      }
      if (v.approvalShort) {
        return {
          tone: "short",
          label: "Short on approval",
          sub: `Needs ${f.pct(v.approvalNeededAtEnd)} aye by ${f.day(v.decisionEnd!)}`,
          body: `At least ${f.pct(v.approvalNeededAtEnd)} of the votes, weighted by conviction, must be aye by the end. It's at ${f.pct(v.approval)}. Unless that changes by ${by}, it's rejected.`,
          note: v.supportShort
            ? `Support is short too: ${f.amount(v.supportFloor - v.supportMissing)} of ${floor} needed.`
            : null,
        }
      }
      return {
        tone: "short",
        label: "Short on support",
        sub: `Needs ${f.amount(v.supportMissing)} more support by ${f.day(v.decisionEnd!)}`,
        body: `Even at the end of the decision period it needs ${f.pct(v.supportNeededAtEnd)} ${f.ofIssuance ?? "of issuance"} as support, that's ${floor}. It has ${f.amount(v.supportFloor - v.supportMissing)}, so it needs ${f.amount(v.supportMissing)} more from aye or abstain votes by ${by}, or it's rejected.`,
        note: "Nay votes and conviction don't count toward support.",
      }
    }
  }
}

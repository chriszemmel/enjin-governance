/**
 * What the lifecycle card says, worked out from a `Lifecycle`: the time
 * left at the top, one row per step with its date, and the one-line summary
 * of a referendum that has run its course. Pure, so the wording is tested
 * without rendering. Dates are relative to `now` (UTC).
 */

import { blockToDate, formatBlockDuration, formatRelativeBlockTime } from "@/lib/chain/format"
import type { Lifecycle, LifecycleStage, LifecycleStageState } from "./lifecycle"

export type Tone = "default" | "muted" | "warn" | "danger"

export type StepRow = {
  key: string
  label: string
  note: string | null
  noteTone: Tone
  state: LifecycleStageState
  /** Payout steps get a dashed dot while they're still to come. */
  dashed?: boolean
  when: { main: string; sub?: string; mono?: boolean } | null
}

type Hero = {
  /** The time left, or null for a status without one (awaiting the deposit). */
  big: string | null
  unit: string
  pill: string
  approved: boolean
  progress: number
}

export function heroFor(lifecycle: Lifecycle, currentBlock: number | null): Hero {
  const stage = lifecycle.stages.find((s) => s.id === lifecycle.activeStageId) ?? null
  const payout = lifecycle.payout
  const approved = lifecycle.terminal === "approved"

  if (lifecycle.awaitingDecisionDeposit) {
    return {
      big: null,
      unit: "Waiting for the decision deposit",
      pill: "Preparing",
      approved: false,
      progress: 0,
    }
  }
  if (!stage && payout?.state === "active" && payout.block != null) {
    const since = payout.since ?? null
    const span = since != null ? payout.block - since : 0
    return {
      big: timeLeft(payout.block, currentBlock),
      unit: "to payout",
      pill: "Approved",
      approved,
      progress:
        since != null && currentBlock != null && span > 0
          ? clamp01((currentBlock - since) / span)
          : 0,
    }
  }
  const unit: Record<LifecycleStage["id"], string> = {
    prepare: "until voting opens",
    decide: "left to vote",
    confirm: "left to confirm",
    enact: "to enactment",
  }
  const pill: Record<LifecycleStage["id"], string> = {
    prepare: "Preparing",
    decide: "Deciding",
    confirm: "Confirming",
    enact: "Approved",
  }
  const id = stage?.id ?? "enact"
  return {
    big: stage?.endBlock != null ? timeLeft(stage.endBlock, currentBlock) : "-",
    unit: unit[id],
    pill: pill[id],
    approved,
    progress: stage?.progress ?? 0,
  }
}

/** "13d 13h", or "any block now" once the block is due. */
function timeLeft(block: number, currentBlock: number | null): string {
  if (currentBlock == null) return "-"
  const left = block - currentBlock
  return left > 0 ? formatBlockDuration(left) : "Now"
}

export function stepRows(
  lifecycle: Lifecycle,
  currentBlock: number | null,
  amount: string | null,
): StepRow[] {
  const byId = Object.fromEntries(lifecycle.stages.map((s) => [s.id, s])) as Record<
    LifecycleStage["id"],
    LifecycleStage
  >
  const rows: StepRow[] = lifecycle.stages.map((stage) =>
    stageRow(stage, byId, lifecycle, currentBlock),
  )
  const payout = lifecycle.payout
  if (payout) {
    const label = amount ? `Payout · ${amount}` : "Payout"
    const due = payout.block
    switch (payout.state) {
      case "active":
        rows.push({
          key: "payout",
          label,
          note: "At the next spend period, if the treasury can cover it",
          noteTone: "muted",
          state: "active",
          when:
            due != null
              ? {
                  main: `#${formatBlockNumber(due)}`,
                  sub: whenText(due, currentBlock, true),
                  mono: true,
                }
              : null,
        })
        break
      case "done":
        rows.push({
          key: "payout",
          label: amount ? `Paid out · ${amount}` : "Paid out",
          note: payout.proposalIndex != null ? `Treasury proposal #${payout.proposalIndex}` : null,
          noteTone: "muted",
          state: "done",
          when: null,
        })
        break
      case "skipped":
        rows.push({
          key: "payout",
          label: "No payout",
          note: "The call failed when it was enacted",
          noteTone: "danger",
          state: "skipped",
          when: null,
        })
        break
      default:
        rows.push({
          key: "payout",
          label,
          note: "At the next spend period",
          noteTone: "muted",
          state: payout.state === "upcoming" ? "upcoming" : "unknown",
          dashed: true,
          when: due != null ? { main: whenText(due, currentBlock, true) } : null,
        })
    }
  }
  return rows
}

function stageRow(
  stage: LifecycleStage,
  byId: Record<LifecycleStage["id"], LifecycleStage>,
  lifecycle: Lifecycle,
  currentBlock: number | null,
): StepRow {
  const row: StepRow = {
    key: stage.id,
    label: stage.label,
    note: null,
    noteTone: "muted",
    state: stage.state,
    when: null,
  }
  const at = stage.expectedEnd
  const past = at != null ? { main: whenText(at, currentBlock, false) } : null
  const ahead = at != null ? { main: whenText(at, currentBlock, true) } : null

  switch (stage.state) {
    case "done":
      row.when = past
      if (stage.id === "prepare") row.note = "Decision deposit placed"
      if (stage.id === "decide") row.note = "Passed"
      if (stage.id === "confirm") row.note = "Approved"
      if (stage.id === "enact") row.note = "The call ran"
      return row
    case "failed":
      row.when = past
      row.note = "The call failed when it was enacted"
      row.noteTone = "danger"
      return row
    case "skipped":
    case "cancelled":
      row.note = stage.state === "skipped" ? "Skipped" : "Cancelled"
      return row
    case "active":
      if (stage.id === "prepare") {
        if (lifecycle.awaitingDecisionDeposit) {
          row.note = "Anyone can place the decision deposit"
          row.noteTone = "warn"
        } else {
          row.note = "Voting opens after the prepare period"
          row.when = ahead && { main: `opens ${ahead.main}` }
        }
      } else if (stage.id === "decide") {
        row.note = "Needs approval and support"
        row.when = ahead && { main: `ends ${ahead.main}` }
      } else if (stage.id === "confirm") {
        row.note = `Holding for ${formatBlockDuration(stage.durationBlocks)}`
        row.when = ahead
      } else {
        row.note = "The call is scheduled"
        row.when =
          at != null
            ? {
                main: `#${formatBlockNumber(at)}`,
                sub: whenText(at, currentBlock, true),
                mono: true,
              }
            : null
      }
      return row
    default: {
      // Upcoming, or unknown (an Approved call the scheduler hasn't told us about).
      row.when = ahead
      if (stage.id === "decide") row.note = "Needs approval and support"
      if (stage.id === "confirm") {
        const starts = lifecycle.confirmStartsAt
        row.note =
          starts != null
            ? `Starts at #${formatBlockNumber(starts)}, holds ${formatBlockDuration(stage.durationBlocks)}`
            : `Holds ${formatBlockDuration(stage.durationBlocks)} once it passes`
      }
      if (stage.id === "enact") {
        const confirm = byId.confirm
        const approvedAt = confirm.expectedEnd
        const gap = at != null && approvedAt != null ? at - approvedAt : null
        row.note =
          stage.state === "unknown"
            ? "Can't tell from the scheduler yet"
            : gap != null && gap > 0
              ? `The call runs ${formatBlockDuration(gap)} after approval`
              : "The call runs after approval"
      }
      return row
    }
  }
}

export function finishedSummary(
  lifecycle: Lifecycle,
  currentBlock: number | null,
  decidedAt: number | null,
  amount: string | null,
): { title: string; sub: string | null; tone: "ok" | "danger" | "muted" } {
  const on = (block: number | null) => (block != null ? ` on ${dayText(block, currentBlock)}` : "")
  switch (lifecycle.terminal) {
    case "approved": {
      const enact = lifecycle.stages.find((s) => s.id === "enact")
      const enactedAt = enact?.endBlock ?? null
      const payout = lifecycle.payout
      if (enact?.state === "failed") {
        return { title: `Enacted${on(enactedAt)}`, sub: "The call failed", tone: "danger" }
      }
      if (enact?.state === "done") {
        if (payout?.state === "done") {
          const parts = [
            enactedAt != null ? `Enacted ${dayText(enactedAt, currentBlock)}` : null,
            payout.proposalIndex != null ? `treasury proposal #${payout.proposalIndex}` : null,
          ].filter(Boolean)
          return {
            title: amount ? `Paid out ${amount}` : "Paid out",
            sub: parts.join(" · ") || null,
            tone: "ok",
          }
        }
        if (payout?.state === "skipped") {
          return { title: `Enacted${on(enactedAt)}`, sub: "No payout", tone: "danger" }
        }
        const sub = [
          decidedAt != null ? `Approved ${dayText(decidedAt, currentBlock)}` : null,
          enactedAt != null ? `#${formatBlockNumber(enactedAt)}` : null,
        ].filter(Boolean)
        return { title: `Enacted${on(enactedAt)}`, sub: sub.join(" · ") || null, tone: "ok" }
      }
      return { title: `Approved${on(decidedAt)}`, sub: null, tone: "ok" }
    }
    case "rejected":
      return {
        title: `Rejected${on(decidedAt)}`,
        sub: "Voting ended without passing",
        tone: "danger",
      }
    case "timedout":
      return {
        title: `Timed out${on(decidedAt)}`,
        sub: "No decision deposit was placed in time",
        tone: "muted",
      }
    case "cancelled":
      return { title: `Cancelled${on(decidedAt)}`, sub: null, tone: "muted" }
    case "killed":
      return { title: `Killed${on(decidedAt)}`, sub: "Ended by governance", tone: "danger" }
    default:
      return { title: "Ended", sub: null, tone: "muted" }
  }
}

const DAY_MS = 86_400_000

/**
 * A block as a short date: "Oct 21", with the year when it isn't this one.
 * Within a day of now it says how long ago or ahead instead ("11 hours ago").
 */
export function dayText(block: number, currentBlock: number | null): string {
  if (currentBlock == null) return `#${formatBlockNumber(block)}`
  const now = new Date()
  const date = blockToDate(block, currentBlock, now)
  if (Math.abs(date.getTime() - now.getTime()) < DAY_MS) {
    return formatRelativeBlockTime(block, currentBlock, now)
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: "numeric" } : {}),
    timeZone: "UTC",
  })
}

/** A step's date: future ones are estimates ("≈ Oct 21"). */
function whenText(block: number, currentBlock: number | null, future: boolean): string {
  const text = dayText(block, currentBlock)
  return future && currentBlock != null && block > currentBlock ? `≈ ${text}` : text
}

export function formatBlockNumber(block: number): string {
  return block.toLocaleString("en-US")
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return n > 1 ? 1 : n
}

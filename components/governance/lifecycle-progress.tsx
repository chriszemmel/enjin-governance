"use client"

import { useId } from "react"
import { Check, Coins, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import { useEnactment } from "@/lib/query/hooks/use-enactment"
import { useReferendumHistory } from "@/lib/query/hooks/use-referendum-history"
import { useSpendPayout } from "@/lib/query/hooks/use-spend-payout"
import {
  blockToDate,
  formatAbsoluteTime,
  formatBlockDuration,
  formatRelativeBlockTime,
} from "@/lib/chain/format"
import type { ProposalIntent } from "@/lib/governance/call-extract"
import {
  getLifecycle,
  type Lifecycle,
  type LifecycleStage,
  type PayoutView,
  type TimelineEvent,
} from "@/lib/governance/lifecycle"
import { localSpendTarget } from "@/lib/governance/payout"
import type { Referendum, Track } from "@/lib/governance/types"

interface LifecycleProgressProps {
  referendum: Referendum
  track: Track | null | undefined
  /** Override the chain head - used by previews/tests. */
  currentBlockOverride?: number | null
  className?: string
}

interface LifecycleDetailProps extends LifecycleProgressProps {
  /** The decoded call. A treasury spend_local adds the payout line. */
  intent?: ProposalIntent
}

/**
 * The lifecycle card on the detail page: a four-stage stepper, the payout
 * of a treasury spend_local under it, and the events with their blocks.
 */
export function LifecycleProgress({
  referendum,
  track,
  intent,
  currentBlockOverride,
  className,
}: LifecycleDetailProps) {
  const currentBlockQuery = useCurrentBlock()
  const currentBlock =
    currentBlockOverride !== undefined ? currentBlockOverride : (currentBlockQuery.data ?? null)
  // A decided referendum's status just before the decision places the
  // earlier blocks. Same query (and cache entry) as the page's.
  const decidedAt = referendum.status.type === "Ongoing" ? null : referendum.status.at
  const historyQuery = useReferendumHistory(referendum.index, decidedAt)
  const history = historyQuery.data?.status.type === "Ongoing" ? historyQuery.data.status : null
  // The enactment record reads the archive too: let the history (which the
  // page's tally and call summary wait on) go first.
  const enactment = useEnactment(referendum, {
    withRecord: historyQuery.isSuccess || historyQuery.isError,
  })
  const spend = useSpendPayout(referendum.index, localSpendTarget(intent), enactment)
  const lifecycle = getLifecycle(referendum, track ?? null, currentBlock, {
    history,
    enactment: enactment.state,
    spend,
  })
  return <LifecycleCard lifecycle={lifecycle} currentBlock={currentBlock} className={className} />
}

/** The lifecycle card for a computed `Lifecycle` (no chain reads). */
function LifecycleCard({
  lifecycle,
  currentBlock,
  className,
}: {
  lifecycle: Lifecycle
  currentBlock: number | null
  className?: string
}) {
  const activeStage = lifecycle.stages.find((s) => s.id === lifecycle.activeStageId) ?? null
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className={cn("rounded-2xl bg-card border border-border p-6", className)}
    >
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h2 id={headingId} className="font-semibold text-foreground">
            Lifecycle
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {headlineForLifecycle(lifecycle)}
          </p>
        </div>
        {activeStage && (
          <ActiveStageBanner
            stage={activeStage}
            currentBlock={currentBlock}
            awaitingDeposit={lifecycle.awaitingDecisionDeposit}
          />
        )}
      </div>

      <StageStepper lifecycle={lifecycle} currentBlock={currentBlock} />

      {lifecycle.awaitingDecisionDeposit && (
        <p className="text-[11px] text-amber-500 mt-4 leading-relaxed">
          Deciding can&apos;t begin until the per-track decision deposit is
          reserved. Anyone can place it.
        </p>
      )}

      {lifecycle.payout && <PayoutLine payout={lifecycle.payout} currentBlock={currentBlock} />}

      {lifecycle.timeline.length > 0 && (
        <Timeline events={lifecycle.timeline} currentBlock={currentBlock} />
      )}
    </section>
  )
}

/**
 * One-line mini progress bar suitable for proposal cards. No labels, just
 * the bar and a short status line above. Renders nothing once nothing is in
 * progress - an Approved referendum shows it while its call is scheduled.
 */
export function LifecycleMini({
  referendum,
  track,
  currentBlockOverride,
  className,
}: LifecycleProgressProps) {
  const currentBlockQuery = useCurrentBlock()
  const currentBlock =
    currentBlockOverride !== undefined ? currentBlockOverride : (currentBlockQuery.data ?? null)
  const enactment = useEnactment(referendum)
  const lifecycle = getLifecycle(referendum, track ?? null, currentBlock, {
    enactment: enactment.state,
  })

  const activeStage = lifecycle.stages.find((s) => s.id === lifecycle.activeStageId) ?? null
  // Decided and enacted (or ended) - the status pill already says it all.
  if (!activeStage) return null

  const headline = miniHeadline(lifecycle, activeStage, currentBlock)

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground font-medium">{activeStage.label}</span>
        <span className="text-muted-foreground tabular-nums">{headline}</span>
      </div>
      <SegmentedBar lifecycle={lifecycle} />
    </div>
  )
}

function StageStepper({
  lifecycle,
  currentBlock,
}: {
  lifecycle: Lifecycle
  currentBlock: number | null
}) {
  return (
    <ol className="grid grid-cols-4 gap-1.5">
      {lifecycle.stages.map((stage, i) => (
        <StageColumn
          key={stage.id}
          stage={stage}
          currentBlock={currentBlock}
          awaitingDeposit={lifecycle.awaitingDecisionDeposit}
          isLast={i === lifecycle.stages.length - 1}
        />
      ))}
    </ol>
  )
}

function StageColumn({
  stage,
  currentBlock,
  awaitingDeposit,
  isLast,
}: {
  stage: LifecycleStage
  currentBlock: number | null
  awaitingDeposit: boolean
  isLast: boolean
}) {
  const tone = toneForState(stage.state)

  return (
    <li className="flex flex-col min-w-0">
      <div className="flex items-center gap-1.5">
        <StageDot stage={stage} />
        <div
          className={cn(
            "h-[2px] flex-1 rounded-full",
            isLast && "opacity-0",
            stage.state === "active"
              ? "bg-primary/60"
              : stage.state === "done"
                ? "bg-muted-foreground/40"
                : "bg-border",
          )}
        />
      </div>

      <div className="mt-2.5">
        <p className={cn("text-[11px] font-semibold uppercase tracking-wide", tone.label)}>
          {stage.label}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {stageSubline(stage, currentBlock, awaitingDeposit)}
        </p>
      </div>

      {/* Per-stage progress bar - full when done, proportional when active,
          empty otherwise. Sits below the label so it has its own row. */}
      <div className="mt-2 h-1 rounded-full bg-surface-3 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            stage.state === "done"
              ? "bg-muted-foreground/40"
              : stage.state === "active"
                ? "bg-primary"
                : stage.state === "failed"
                  ? "bg-destructive/60"
                  : stage.state === "skipped" || stage.state === "cancelled"
                    ? "bg-muted-foreground/30"
                    : "bg-transparent",
          )}
          style={{ width: `${Math.round(stage.progress * 100)}%` }}
        />
      </div>
    </li>
  )
}

function StageDot({ stage }: { stage: LifecycleStage }) {
  if (stage.state === "done") {
    return (
      <div className="w-5 h-5 rounded-full bg-surface-2 border border-border flex items-center justify-center flex-shrink-0">
        <Check className="w-3 h-3 text-muted-foreground" />
      </div>
    )
  }
  if (stage.state === "active") {
    return (
      <div className="w-5 h-5 rounded-full bg-primary/15 border border-primary flex items-center justify-center flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
      </div>
    )
  }
  if (stage.state === "failed") {
    return (
      <div className="w-5 h-5 rounded-full bg-destructive/10 border border-destructive/50 flex items-center justify-center flex-shrink-0">
        <X className="w-3 h-3 text-destructive" />
      </div>
    )
  }
  if (stage.state === "skipped" || stage.state === "cancelled") {
    return (
      <div className="w-5 h-5 rounded-full bg-muted/20 border border-border flex items-center justify-center flex-shrink-0">
        <X className="w-3 h-3 text-muted-foreground/70" />
      </div>
    )
  }
  return (
    <div
      className={cn(
        "w-5 h-5 rounded-full bg-surface-2 border border-border flex-shrink-0",
        stage.state === "unknown" && "border-dashed",
      )}
    />
  )
}

function ActiveStageBanner({
  stage,
  currentBlock,
  awaitingDeposit,
}: {
  stage: LifecycleStage
  currentBlock: number | null
  awaitingDeposit: boolean
}) {
  // Awaiting deposit is the headline state - replace the time-remaining
  // pair with a "Status · Awaiting deposit" pair so the user sees the
  // blocker, not a misleading "-" or "ending" countdown.
  if (awaitingDeposit) {
    return (
      <div className="text-right">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Status
        </p>
        <p className="text-sm font-semibold text-amber-500">Awaiting deposit</p>
      </div>
    )
  }

  const remaining = remainingForStage(stage, currentBlock)
  const ends = endsAtForStage(stage, currentBlock)

  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Time remaining
      </p>
      <p className="text-sm font-semibold text-foreground tabular-nums" title={ends ?? undefined}>
        {remaining ?? "-"}
      </p>
    </div>
  )
}

/** The payout of a treasury spend_local, as one compact line. */
function PayoutLine({ payout, currentBlock }: { payout: PayoutView; currentBlock: number | null }) {
  return (
    <p
      className={cn(
        "mt-4 flex items-start gap-2 text-xs leading-relaxed",
        payout.state === "done" ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Coins
        className={cn(
          "w-3.5 h-3.5 mt-0.5 flex-shrink-0",
          payout.state === "active" ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0">{payoutText(payout, currentBlock)}</span>
    </p>
  )
}

function payoutText(payout: PayoutView, currentBlock: number | null): string {
  const at = (block: number | null, approx: boolean) => {
    if (block == null) return ""
    const when = currentBlock != null ? ` (${formatRelativeBlockTime(block, currentBlock)})` : ""
    return `, ${approx ? "about " : ""}block ${formatBlockNumber(block)}${when}`
  }
  switch (payout.state) {
    case "upcoming":
      return `Payout · first spend period after enactment${at(payout.block, payout.approx)}`
    case "active":
      return `Payout · next spend period${at(payout.block, false)}, if the treasury can cover it`
    case "done":
      return payout.proposalIndex != null
        ? `Paid out · treasury proposal #${payout.proposalIndex}`
        : "Paid out"
    case "skipped":
      return "No payout · the call failed when it was enacted"
    default:
      // Short enough for one line at 360 px, like the states it turns into.
      return "Payout · status unknown"
  }
}

/** The lifecycle's events with their blocks, one row each (Subscan style). */
function Timeline({
  events,
  currentBlock,
}: {
  events: TimelineEvent[]
  currentBlock: number | null
}) {
  return (
    <ol className="mt-5 pt-4 border-t border-border space-y-2.5" aria-label="Timeline">
      {events.map((event) => (
        <li
          key={event.id}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 text-xs"
        >
          <TimelineDot status={event.status} />
          <div className="min-w-0">
            <p
              className={cn(
                "leading-snug",
                event.status === "done"
                  ? "text-foreground"
                  : event.status === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              {event.label}
            </p>
            {event.note && (
              <p className="text-[10px] text-muted-foreground leading-snug">{event.note}</p>
            )}
          </div>
          <TimelineWhen event={event} currentBlock={currentBlock} />
        </li>
      ))}
    </ol>
  )
}

function TimelineWhen({ event, currentBlock }: { event: TimelineEvent; currentBlock: number | null }) {
  if (event.block == null) {
    return <span className="text-[11px] text-muted-foreground/70 text-right">-</span>
  }
  const date = currentBlock != null ? blockToDate(event.block, currentBlock) : null
  return (
    <div className="text-right leading-snug" title={date ? formatAbsoluteTime(date) : undefined}>
      <p className="font-mono text-[11px] text-foreground tabular-nums whitespace-nowrap">
        {event.approx && <span className="text-muted-foreground">≈ </span>}#
        {formatBlockNumber(event.block)}
      </p>
      {currentBlock != null && (
        <p className="text-[10px] text-muted-foreground whitespace-nowrap">
          {formatRelativeBlockTime(event.block, currentBlock)}
        </p>
      )}
    </div>
  )
}

function TimelineDot({ status }: { status: TimelineEvent["status"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-[5px] w-2 h-2 rounded-full flex-shrink-0",
        status === "done"
          ? "bg-muted-foreground/60"
          : status === "failed"
            ? "bg-destructive"
            : status === "unknown"
              ? "border border-dashed border-muted-foreground/60"
              : "border border-primary",
      )}
    />
  )
}

// Segmented bar (compact)
function SegmentedBar({ lifecycle }: { lifecycle: Lifecycle }) {
  return (
    <div className="flex items-center gap-[3px]">
      {lifecycle.stages.map((stage) => (
        <div
          key={stage.id}
          className="flex-1 h-1 rounded-full bg-surface-3 overflow-hidden"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              stage.state === "done"
                ? "bg-muted-foreground/40"
                : stage.state === "active"
                  ? "bg-primary"
                  : "bg-transparent",
            )}
            style={{ width: `${Math.round(stage.progress * 100)}%` }}
          />
        </div>
      ))}
    </div>
  )
}

function headlineForLifecycle(lifecycle: Lifecycle): string {
  if (lifecycle.terminal) {
    switch (lifecycle.terminal) {
      case "approved": {
        const enact = lifecycle.stages.find((s) => s.id === "enact")?.state
        if (enact === "active") return "Approved - the call is scheduled to run."
        if (enact === "failed") return "Approved, but the call failed when it was enacted."
        if (enact === "done") return "Approved and enacted on chain."
        return "Approved."
      }
      case "rejected":
        return "Rejected - did not meet the approval and support thresholds."
      case "cancelled":
        return "Cancelled before reaching a decision."
      case "killed":
        return "Force-killed by governance."
      case "timedout":
        return "Timed out without a decision deposit."
    }
  }
  if (lifecycle.awaitingDecisionDeposit) {
    return "Awaiting the decision deposit before voting opens."
  }
  switch (lifecycle.activeStageId) {
    case "prepare":
      return "Preparing - voting opens after the prepare period."
    case "decide":
      return "Voting is open."
    case "confirm":
      return "In confirmation - threshold being held."
    case "enact":
      return "Awaiting on-chain enactment."
    default:
      return ""
  }
}

function miniHeadline(
  lifecycle: Lifecycle,
  active: LifecycleStage | null,
  currentBlock: number | null,
): string {
  if (lifecycle.awaitingDecisionDeposit) return "Awaiting deposit"
  if (!active) return ""
  const remaining = remainingForStage(active, currentBlock)
  return remaining ?? "Ending"
}

function toneForState(state: LifecycleStage["state"]) {
  switch (state) {
    case "active":
    case "done":
      return { label: "text-foreground" }
    case "failed":
      return { label: "text-destructive" }
    case "skipped":
    case "cancelled":
      return { label: "text-muted-foreground/60" }
    case "upcoming":
    case "unknown":
    default:
      return { label: "text-muted-foreground" }
  }
}

/** One short line per stage column - the details are in the timeline. */
function stageSubline(
  stage: LifecycleStage,
  currentBlock: number | null,
  awaitingDeposit: boolean,
): string {
  switch (stage.state) {
    case "skipped":
      return "Skipped"
    case "cancelled":
      return "Cancelled"
    case "failed":
      return "Failed"
    case "unknown":
      return "-"
    case "active": {
      if (awaitingDeposit && stage.id === "prepare") return "Awaiting deposit"
      const remaining = remainingForStage(stage, currentBlock)
      if (remaining) return `${remaining} left`
      // End block has been reached - chain hasn't transitioned yet (typical
      // 1-block lag). Avoid "0s left" / "ending left"; say it cleanly.
      return "Ending"
    }
    case "done": {
      // How long it actually took, when both ends are known and past.
      const { startBlock: start, endBlock: end } = stage
      if (start != null && end != null && currentBlock != null && end <= currentBlock) {
        return formatBlockDuration(end - start)
      }
      return formatBlockDuration(stage.durationBlocks)
    }
    default:
      return formatBlockDuration(stage.durationBlocks)
  }
}

function remainingForStage(
  stage: LifecycleStage,
  currentBlock: number | null,
): string | null {
  if (stage.endBlock == null || currentBlock == null) return null
  const remaining = stage.endBlock - currentBlock
  if (remaining <= 0) return null
  return formatBlockDuration(remaining)
}

function endsAtForStage(
  stage: LifecycleStage,
  currentBlock: number | null,
): string | null {
  if (stage.endBlock == null || currentBlock == null) return null
  const date = blockToDate(stage.endBlock, currentBlock)
  return `Ends ${formatAbsoluteTime(date)}`
}

function formatBlockNumber(block: number): string {
  return block.toLocaleString("en-US")
}

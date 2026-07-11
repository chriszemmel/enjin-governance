"use client"

import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import {
  blockToDate,
  formatAbsoluteTime,
  formatBlockDuration,
  formatRelativeBlockTime,
} from "@/lib/chain/format"
import {
  getLifecycle,
  type Lifecycle,
  type LifecycleStage,
} from "@/lib/governance/lifecycle"
import type { Referendum, Track } from "@/lib/governance/types"

interface LifecycleProgressProps {
  referendum: Referendum
  track: Track | null | undefined
  /** Override the chain head - used by previews/tests. */
  currentBlockOverride?: number | null
  className?: string
}

/**
 * Full horizontal stepper showing the four lifecycle stages and where the
 * referendum currently sits. Renders on the detail page.
 */
export function LifecycleProgress({
  referendum,
  track,
  currentBlockOverride,
  className,
}: LifecycleProgressProps) {
  const currentBlockQuery = useCurrentBlock()
  const currentBlock =
    currentBlockOverride !== undefined ? currentBlockOverride : (currentBlockQuery.data ?? null)
  const lifecycle = getLifecycle(referendum, track ?? null, currentBlock)
  const activeStage = lifecycle.stages.find((s) => s.id === lifecycle.activeStageId) ?? null

  return (
    <div className={cn("rounded-2xl bg-card border border-border p-6", className)}>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h2 className="font-semibold text-foreground">Lifecycle</h2>
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
    </div>
  )
}

/**
 * One-line mini progress bar suitable for proposal cards. No labels, just
 * the bar and a short status line above.
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
  const lifecycle = getLifecycle(referendum, track ?? null, currentBlock)

  // Terminal - don't render anything; the status pill already says it all.
  if (lifecycle.terminal) return null

  const activeStage = lifecycle.stages.find((s) => s.id === lifecycle.activeStageId) ?? null
  const headline = miniHeadline(lifecycle, activeStage, currentBlock)

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground font-medium">
          {activeStage ? activeStage.label : "-"}
        </span>
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
    <li className="flex flex-col">
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
        <p className="text-[11px] text-muted-foreground mt-0.5">
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
  if (stage.state === "skipped" || stage.state === "cancelled") {
    return (
      <div className="w-5 h-5 rounded-full bg-muted/20 border border-border flex items-center justify-center flex-shrink-0">
        <X className="w-3 h-3 text-muted-foreground/70" />
      </div>
    )
  }
  return (
    <div className="w-5 h-5 rounded-full bg-surface-2 border border-border flex-shrink-0" />
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
      case "approved":
        return "Approved and enacted on chain."
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
      return { label: "text-foreground" }
    case "done":
      return { label: "text-foreground" }
    case "skipped":
    case "cancelled":
      return { label: "text-muted-foreground/60" }
    case "upcoming":
    default:
      return { label: "text-muted-foreground" }
  }
}

function stageSubline(
  stage: LifecycleStage,
  currentBlock: number | null,
  awaitingDeposit: boolean,
): string {
  if (stage.state === "skipped") return "Skipped"
  if (stage.state === "cancelled") return "Cancelled"

  if (stage.state === "active") {
    if (awaitingDeposit && stage.id === "prepare") return "Awaiting deposit"
    const remaining = remainingForStage(stage, currentBlock)
    if (remaining) return `${remaining} left`
    // End block has been reached - chain hasn't transitioned yet (typical
    // 1-block lag). Avoid "0s left" / "ending left"; say it cleanly.
    return "Ending"
  }

  if (stage.state === "done") {
    // For ongoing referenda, "done" still corresponds to a concrete completion
    // block - surface it if we know it. For terminal referenda the per-stage
    // block ranges are unknown; fall back to the static stage length.
    if (stage.endBlock != null && currentBlock != null) {
      return formatRelativeBlockTime(stage.endBlock, currentBlock)
    }
    return formatBlockDuration(stage.durationBlocks)
  }

  // upcoming
  return formatBlockDuration(stage.durationBlocks)
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

"use client"

import { useId, useState } from "react"
import { Check, ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useActiveChain } from "@/lib/chain/use-chain"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import { useEnactment } from "@/lib/query/hooks/use-enactment"
import { useReferendumHistory } from "@/lib/query/hooks/use-referendum-history"
import { useSpendPayout } from "@/lib/query/hooks/use-spend-payout"
import {
  blockToDate,
  formatAbsoluteTime,
  formatBlockDuration,
  formatTokenAmount,
} from "@/lib/chain/format"
import type { ProposalIntent } from "@/lib/governance/call-extract"
import {
  getLifecycle,
  type Lifecycle,
  type LifecycleStage,
  type LifecycleStageState,
  type TimelineEvent,
} from "@/lib/governance/lifecycle"
import {
  dayText,
  finishedSummary,
  formatBlockNumber,
  heroFor,
  type StepRow,
  stepRows,
} from "@/lib/governance/lifecycle-view"
import { localSpendTarget } from "@/lib/governance/payout"
import type { Referendum, Track } from "@/lib/governance/types"

interface LifecycleProgressProps {
  referendum: Referendum
  track: Track | null | undefined
  /** The amount a treasury spend pays, decoded from its call. */
  amount?: string | null
  /** Override the chain head - used by previews/tests. */
  currentBlockOverride?: number | null
  className?: string
}

interface LifecycleDetailProps extends LifecycleProgressProps {
  /** The decoded call. A treasury spend_local adds the payout step. */
  intent?: ProposalIntent
}

/**
 * The lifecycle card on the detail page. While anything is still to come
 * (voting, confirmation, enactment, a payout) it leads with the time left
 * and lists the steps with their dates. Once it has all happened it folds
 * to one line, with the events and their blocks behind "Details".
 */
export function LifecycleProgress({
  referendum,
  track,
  intent,
  currentBlockOverride,
  className,
}: LifecycleDetailProps) {
  const chain = useActiveChain()
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
  const target = localSpendTarget(intent)
  const spend = useSpendPayout(referendum.index, target, enactment)
  const lifecycle = getLifecycle(referendum, track ?? null, currentBlock, {
    history,
    enactment: enactment.state,
    spend,
  })
  const amount = target ? formatTokenAmount(target.amount, chain, { maxFractionDigits: 2 }) : null

  const done =
    lifecycle.terminal != null &&
    lifecycle.activeStageId == null &&
    lifecycle.payout?.state !== "active" &&
    lifecycle.payout?.state !== "upcoming"

  return done ? (
    <FinishedCard
      lifecycle={lifecycle}
      currentBlock={currentBlock}
      decidedAt={decidedAt}
      amount={amount}
      className={className}
    />
  ) : (
    <RunningCard
      lifecycle={lifecycle}
      currentBlock={currentBlock}
      amount={amount}
      className={className}
    />
  )
}

// ---------------------------------------------------------------- running

function RunningCard({
  lifecycle,
  currentBlock,
  amount,
  className,
}: {
  lifecycle: Lifecycle
  currentBlock: number | null
  amount: string | null
  className?: string
}) {
  const headingId = useId()
  const hero = heroFor(lifecycle, currentBlock)
  const rows = stepRows(lifecycle, currentBlock, amount)
  const estimated = rows.some((r) => r.state === "upcoming" && r.when?.main.startsWith("≈"))

  return (
    <section
      aria-labelledby={headingId}
      className={cn("rounded-2xl bg-card border border-border p-5 sm:p-6", className)}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Lifecycle
          </h2>
          {hero.big ? (
            <p className="mt-1 text-[28px] font-semibold leading-tight tracking-tight tabular-nums text-foreground">
              {hero.big}{" "}
              <span className="text-sm font-medium tracking-normal text-muted-foreground">
                {hero.unit}
              </span>
            </p>
          ) : (
            <p className="mt-1.5 text-base font-semibold text-amber-500">{hero.unit}</p>
          )}
        </div>
        <span
          className={cn(
            "mb-1 flex-shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px]",
            hero.approved
              ? "border-green-500/50 text-green-600 dark:text-green-400"
              : "border-primary/60 text-primary-text",
          )}
        >
          {hero.pill}
        </span>
      </div>

      <div className="mt-3.5 mb-5 h-1 rounded-full bg-surface-3 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.round(hero.progress * 100)}%` }}
        />
      </div>

      <ol aria-label="Steps">
        {rows.map((row, i) => (
          <StepItem key={row.key} row={row} last={i === rows.length - 1} />
        ))}
      </ol>

      {lifecycle.timeline.length > 0 && (
        <details className="group mt-4 border-t border-border pt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-primary-text [&::-webkit-details-marker]:hidden">
            All events ({lifecycle.timeline.length})
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
          </summary>
          <Timeline events={lifecycle.timeline} currentBlock={currentBlock} />
        </details>
      )}

      {estimated && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          ≈ dates are estimates from block times
          {lifecycle.terminal == null ? ", if it passes." : "."}
        </p>
      )}
    </section>
  )
}

function StepItem({ row, last }: { row: StepRow; last: boolean }) {
  const upcoming = row.state === "upcoming" || row.state === "unknown"
  return (
    <li
      className={cn(
        "relative grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-3",
        last ? "" : "pb-3.5",
      )}
    >
      {!last && (
        <span
          aria-hidden
          className={cn(
            "absolute left-[9px] top-5 bottom-0 w-[2px]",
            row.state === "done"
              ? "bg-muted-foreground/40"
              : row.state === "active"
                ? "bg-[repeating-linear-gradient(to_bottom,var(--border)_0_3px,transparent_3px_6px)]"
                : "bg-border",
          )}
        />
      )}
      <StepDot state={row.state} dashed={row.dashed} />
      <div className="min-w-0">
        <p
          className={cn(
            "text-[13px] leading-5",
            upcoming ? "text-muted-foreground" : "font-medium text-foreground",
            row.state === "failed" && "text-destructive-text",
          )}
        >
          {row.label}
        </p>
        {row.note && (
          <p
            className={cn(
              "text-[11px] leading-snug mt-px",
              row.noteTone === "warn"
                ? "text-amber-500"
                : row.noteTone === "danger"
                  ? "text-destructive-text"
                  : "text-muted-foreground",
            )}
          >
            {row.note}
          </p>
        )}
      </div>
      {row.when && (
        <div
          className={cn(
            "text-right text-xs leading-5 whitespace-nowrap",
            upcoming ? "text-muted-foreground" : "text-foreground",
          )}
        >
          <p className={cn(row.when.mono && "font-mono text-[11px] tabular-nums")}>{row.when.main}</p>
          {row.when.sub && (
            <p className="text-[11px] leading-snug text-muted-foreground">{row.when.sub}</p>
          )}
        </div>
      )}
    </li>
  )
}

function StepDot({ state, dashed }: { state: LifecycleStageState; dashed?: boolean }) {
  const base =
    "relative z-[1] w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0"
  switch (state) {
    case "done":
      return (
        <span className={cn(base, "bg-surface-2 border-border")}>
          <Check className="w-3 h-3 text-muted-foreground" />
        </span>
      )
    case "active":
      return (
        <span className={cn(base, "bg-primary/15 border-primary")}>
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        </span>
      )
    case "failed":
      return (
        <span className={cn(base, "bg-destructive/10 border-destructive/50")}>
          <X className="w-3 h-3 text-destructive" />
        </span>
      )
    case "skipped":
    case "cancelled":
      return (
        <span className={cn(base, "bg-surface-2 border-border")}>
          <X className="w-3 h-3 text-muted-foreground/70" />
        </span>
      )
    default:
      return (
        <span
          className={cn(
            base,
            "bg-surface-2 border-border",
            (dashed || state === "unknown") && "border-dashed",
          )}
        />
      )
  }
}

// --------------------------------------------------------------- finished

function FinishedCard({
  lifecycle,
  currentBlock,
  decidedAt,
  amount,
  className,
}: {
  lifecycle: Lifecycle
  currentBlock: number | null
  decidedAt: number | null
  amount: string | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const headingId = useId()
  const listId = useId()
  const summary = finishedSummary(lifecycle, currentBlock, decidedAt, amount)

  if (!open) {
    return (
      <section
        aria-label="Lifecycle"
        className={cn("rounded-2xl bg-card border border-border", className)}
      >
        <button
          type="button"
          aria-expanded={false}
          aria-controls={listId}
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              "w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0",
              summary.tone === "ok"
                ? "border-green-500/50 text-green-600 dark:text-green-400"
                : summary.tone === "danger"
                  ? "border-destructive/50 text-destructive-text"
                  : "border-border text-muted-foreground",
            )}
          >
            {summary.tone === "ok" ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-foreground">{summary.title}</span>
            {summary.sub && (
              <span className="block text-[11px] text-muted-foreground mt-px">{summary.sub}</span>
            )}
          </span>
          <span className="flex-shrink-0 inline-flex items-center text-xs text-primary-text">
            Details
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </button>
      </section>
    )
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn("rounded-2xl bg-card border border-border p-5 sm:p-6", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="font-semibold text-foreground">
            Lifecycle
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{summary.title}.</p>
        </div>
        <button
          type="button"
          aria-expanded
          aria-controls={listId}
          onClick={() => setOpen(false)}
          className="flex-shrink-0 rounded text-xs text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Hide
        </button>
      </div>
      <div id={listId}>
        <Timeline events={lifecycle.timeline} currentBlock={currentBlock} />
      </div>
    </section>
  )
}

// ------------------------------------------------------------------- mini

/**
 * One-line lifecycle for proposal cards: what's happening and the time
 * left, over a four-part bar. Once nothing is in progress, an Approved
 * referendum shows one line with its approval date instead.
 */
export function LifecycleMini({
  referendum,
  track,
  amount,
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
  if (!activeStage) {
    if (referendum.status.type !== "Approved") return null
    const failed = lifecycle.stages.some((s) => s.state === "failed")
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 text-[11px]",
          failed ? "text-destructive-text" : "text-muted-foreground",
          className,
        )}
      >
        <span>
          {failed ? "Approved, the call failed" : "Approved"}{" "}
          {dayText(referendum.status.at, currentBlock)}
        </span>
        {failed ? (
          <X className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <Check className="w-3.5 h-3.5 flex-shrink-0 text-green-600 dark:text-green-400" />
        )}
      </div>
    )
  }

  const label: Record<LifecycleStage["id"], string> = {
    prepare: lifecycle.awaitingDecisionDeposit ? "Awaiting deposit" : "Preparing",
    decide: "Voting",
    confirm: "Confirming",
    enact: "Enactment",
  }
  const left =
    lifecycle.awaitingDecisionDeposit || activeStage.endBlock == null || currentBlock == null
      ? null
      : activeStage.endBlock - currentBlock

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="text-foreground/80 font-medium">
          {label[activeStage.id]}
          {amount && <span> · {amount}</span>}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {left == null ? "" : left > 0 ? `${formatBlockDuration(left)} left` : "Ending"}
        </span>
      </div>
      <SegmentedBar lifecycle={lifecycle} />
    </div>
  )
}

function SegmentedBar({ lifecycle }: { lifecycle: Lifecycle }) {
  return (
    <div className="flex items-center gap-[3px]">
      {lifecycle.stages.map((stage) => (
        <div key={stage.id} className="flex-1 h-1 rounded-full bg-surface-3 overflow-hidden">
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

// --------------------------------------------------------------- timeline

/** The lifecycle's events with their blocks and dates, one row each. */
function Timeline({
  events,
  currentBlock,
}: {
  events: TimelineEvent[]
  currentBlock: number | null
}) {
  return (
    <ol className="mt-3 space-y-2" aria-label="Timeline">
      {events.map((event) => (
        <li
          key={event.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 text-xs"
        >
          <div className="min-w-0">
            <p
              className={cn(
                "leading-snug",
                event.status === "done"
                  ? "text-foreground"
                  : event.status === "failed"
                    ? "text-destructive-text"
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
    <p
      className="text-right leading-snug whitespace-nowrap text-muted-foreground"
      title={date ? formatAbsoluteTime(date) : undefined}
    >
      <span className="font-mono text-[11px] tabular-nums text-foreground">
        {event.approx && <span className="text-muted-foreground">≈ </span>}#
        {formatBlockNumber(event.block)}
      </span>
      {currentBlock != null && <span className="text-[11px]"> · {dayText(event.block, currentBlock)}</span>}
    </p>
  )
}


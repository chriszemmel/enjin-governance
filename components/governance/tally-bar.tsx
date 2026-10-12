import { Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChainConfig } from "@/lib/chain/chains"
import { formatTokenAmount } from "@/lib/chain/format"
import type { Tally } from "@/lib/governance/types"

interface TallyBarProps {
  tally: Tally | null
  chain?: ChainConfig
  className?: string
  /** When true, render the smaller list-card variant (single split bar). */
  compact?: boolean
  /**
   * Number of distinct voters in this referendum. Surfaced as a
   * summary row above the per-side breakdown so the tally panel
   * mirrors the votes panel and doesn't leave dead space when the
   * conviction-weighted bars happen to be short.
   */
  voterCount?: number | null
}

/**
 * OpenGov tally view.
 *
 *   - `ayes` / `nays` are *conviction-weighted* vote power (sum of
 *     balance x conviction-multiplier across each voter on that side).
 *   - `support` is the *unweighted* balance backing the proposal - what
 *     the support curve evaluates against the chain's turnout threshold.
 *
 * Compact variant: a single horizontal aye/nay split bar, optimised for
 * the proposals-list cards where outcome-at-a-glance matters more than
 * the breakdown.
 *
 * Detail variant: two stacked bars (one per side) with amounts beneath
 * each and the raw-support breakdown after - more space, more detail.
 */
export function TallyBar({
  tally,
  chain,
  compact,
  className,
  voterCount,
}: TallyBarProps) {
  if (!tally) {
    if (compact) {
      return (
        <p className={cn("text-xs text-muted-foreground", className)}>
          No tally available
        </p>
      )
    }
    return (
      <div className={cn("border-t border-border pt-5", className)}>
        <p className="text-xs text-muted-foreground leading-relaxed">
          No tally available for this referendum.
        </p>
      </div>
    )
  }

  const total = tally.ayes + tally.nays
  if (total === 0n) {
    if (compact) {
      return (
        <p className={cn("text-xs text-muted-foreground", className)}>
          Awaiting votes
        </p>
      )
    }
    return (
      <div className={cn("border-t border-border pt-5", className)}>
        <p className="text-xs text-muted-foreground leading-relaxed">
          No votes have been cast on this referendum yet. The aye/nay split
          will appear here within a block or two of the first vote.
        </p>
      </div>
    )
  }

  // 1% resolution is enough for display - keep underlying values bigint.
  const ayePercent = Number((tally.ayes * 10000n) / total) / 100
  const nayPercent = 100 - ayePercent

  if (compact) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <div className="flex items-center justify-between text-xs">
          <span className="text-green-700 dark:text-green-400 font-medium">
            {ayePercent.toFixed(0)}% Aye
          </span>
          <span className="text-red-700 dark:text-red-400 font-medium">
            {nayPercent.toFixed(0)}% Nay
          </span>
        </div>
        <SplitBar ayePercent={ayePercent} />
      </div>
    )
  }

  return (
    <div className={cn("space-y-4", className)}>
      {(voterCount != null || chain) && (
        <div className="grid grid-cols-2 gap-3">
          {chain && (
            <SummaryStat
              label="Total votes"
              value={formatTokenAmount(total, chain, { maxFractionDigits: 2 })}
              monospace
            />
          )}
          {voterCount != null && (
            <SummaryStat
              label="Voters"
              value={voterCount.toLocaleString()}
              icon={<Users className="w-3 h-3" />}
              monospace
            />
          )}
        </div>
      )}

      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Conviction-weighted voting power
      </p>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-green-700 dark:text-green-400 font-medium">Aye</span>
            <span className="text-foreground font-semibold tabular-nums">
              {ayePercent.toFixed(1)}%
            </span>
          </div>
          {chain && (
            <p className="text-[11px] text-muted-foreground font-mono">
              {formatTokenAmount(tally.ayes, chain, { maxFractionDigits: 2 })}
            </p>
          )}
          <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${ayePercent}%` }}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-red-700 dark:text-red-400 font-medium">Nay</span>
            <span className="text-foreground font-semibold tabular-nums">
              {nayPercent.toFixed(1)}%
            </span>
          </div>
          {chain && (
            <p className="text-[11px] text-muted-foreground font-mono">
              {formatTokenAmount(tally.nays, chain, { maxFractionDigits: 2 })}
            </p>
          )}
          <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
            <div
              className="h-full rounded-full bg-red-500 transition-all duration-500"
              style={{ width: `${nayPercent}%` }}
            />
          </div>
        </div>
      </div>

      {chain && tally.support > 0n && (
        <div className="pt-4 mt-1 border-t border-border space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Raw support{" "}
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                (unweighted)
              </span>
            </span>
            <span className="text-foreground font-medium font-mono tabular-nums">
              {formatTokenAmount(tally.support, chain, { maxFractionDigits: 2 })}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Total balance backing the proposal - used by the support curve.
            Voting power above includes the {`<`}1x-6x conviction multiplier.
          </p>
        </div>
      )}
    </div>
  )
}

function SummaryStat({
  label,
  value,
  icon,
  monospace,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  monospace?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "text-sm font-semibold text-foreground tabular-nums",
          monospace && "font-mono",
        )}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * Single horizontal bar split aye (green, left) vs nay (red, right),
 * separated by a 2px gap over a neutral ground. The gap keeps the split
 * legible without relying on the green/red hue distinction alone; the
 * % labels above carry the exact numbers.
 */
function SplitBar({ ayePercent }: { ayePercent: number }) {
  const safeAye = Math.max(0, Math.min(100, ayePercent))
  const hasAye = safeAye > 0
  const hasNay = safeAye < 100
  return (
    <div
      className="flex items-center gap-[2px] w-full h-1.5 rounded-full bg-surface-3"
      role="img"
      aria-label={`Aye ${ayePercent.toFixed(1)} percent, Nay ${(100 - ayePercent).toFixed(1)} percent`}
    >
      {hasAye && (
        <div
          className="h-full rounded-full bg-green-500 transition-all duration-500"
          style={{ width: `${safeAye}%` }}
        />
      )}
      {hasNay && <div className="h-full flex-1 rounded-full bg-red-400" />}
    </div>
  )
}

"use client"

import { Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { evaluateCurve } from "@/lib/governance/curves"
import {
  eligibleMembers,
  rankNumeral,
  rankedShares,
  trackMinRank,
  type FellowshipMember,
  type FellowshipReferendum,
} from "@/lib/governance/fellowship"
import type { Track } from "@/lib/governance/types"

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

/**
 * The rank-weighted tally: who voted out of the members ranked high
 * enough, approval by rank weight and support by head count, each against
 * what the track's curve needs now.
 */
export function RankedTally({
  referendum,
  track,
  members,
  voterCount,
  currentBlock,
}: {
  referendum: FellowshipReferendum
  track: Track | null
  members: FellowshipMember[] | undefined
  /** Votes cast, aye and nay. */
  voterCount: number | null
  currentBlock: number | null
}) {
  const tally = referendum.rankedTally
  if (!tally) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        The runtime keeps a fellowship tally only while the referendum runs.
      </p>
    )
  }
  const trackId = referendum.trackId ?? 0
  const minRank = trackMinRank(trackId)
  const eligible = members ? eligibleMembers(members, minRank).length : 0
  const { approval, support } = rankedShares(tally, eligible)
  const status = referendum.status.type === "Ongoing" ? referendum.status : null
  const since = status?.deciding?.since ?? null
  const x =
    track && since != null && currentBlock != null && track.decisionPeriod > 0
      ? Math.min(1, Math.max(0, (currentBlock - since) / track.decisionPeriod))
      : 0
  const needApproval = track ? evaluateCurve(track.minApproval, x) : null
  const needSupport = track ? evaluateCurve(track.minSupport, x) : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Weighted votes" value={String(tally.ayes + tally.nays)} />
        <Stat
          label="Voters"
          value={`${voterCount ?? "-"}${members ? ` of ${eligible}` : ""}`}
          icon
        />
      </div>
      <Meter
        title="Approval"
        caption={`Ayes ${tally.ayes} · Nays ${tally.nays}`}
        value={approval}
        need={needApproval}
        tone="green"
      />
      <Meter
        title="Support"
        caption={`${tally.bareAyes} of ${eligible} eligible members voted aye (rank ${rankNumeral(minRank)}+)`}
        value={support}
        need={needSupport}
        tone="purple"
      />
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Each member counts (r + 1)(r + 2) / 2, r being their rank above the track&apos;s
        minimum. No conviction, no lock, no ENJ. The marks show what the track&apos;s curves
        need now.
      </p>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-1 border border-border px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon && <Users className="w-3 h-3" />}
        {label}
      </p>
      <p className="text-base font-semibold text-foreground font-mono mt-0.5">{value}</p>
    </div>
  )
}

function Meter({
  title,
  caption,
  value,
  need,
  tone,
}: {
  title: string
  caption: string
  value: number | null
  need: number | null
  tone: "green" | "purple"
}) {
  const passing = value != null && need != null && value >= need
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-foreground">{title}</span>
        <span className="font-mono text-foreground">{value == null ? "-" : pct(value)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-surface-3 overflow-hidden">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            tone === "green" ? "bg-green-500" : "bg-primary",
          )}
          style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
        />
        {need != null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/70"
            style={{ left: `calc(${(need * 100).toFixed(2)}% - 1px)` }}
            aria-hidden
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground gap-2">
        <span>{caption}</span>
        {need != null && (
          <span className={cn("whitespace-nowrap", passing ? "text-green-700 dark:text-green-400" : "")}>
            {passing ? "Passing" : "Needs"} {pct(need)}
          </span>
        )}
      </div>
    </div>
  )
}

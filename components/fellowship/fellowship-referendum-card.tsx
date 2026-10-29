"use client"

import Link from "next/link"
import { Users } from "lucide-react"
import { StatusChip } from "@/components/governance/status-chip"
import {
  fellowshipTrackCaption,
  type FellowshipReferendum,
} from "@/lib/governance/fellowship"
import type { Track } from "@/lib/governance/types"
import { useActiveChain } from "@/lib/chain/use-chain"
import { useCallName } from "./call-summary"

export function FellowshipReferendumCard({
  referendum,
  track,
}: {
  referendum: FellowshipReferendum
  track: Track | null
}) {
  const chain = useActiveChain()
  const callName = useCallName(referendum)
  const tally = referendum.rankedTally
  const total = tally ? tally.ayes + tally.nays : 0
  const ayePct = tally && total > 0 ? Math.round((tally.ayes / total) * 100) : null
  return (
    <Link
      href={`/fellowship/${referendum.index}?network=${chain.id}`}
      className="block rounded-2xl bg-card border border-border p-4 hover:border-purple-border transition-colors"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusChip type={referendum.status.type} />
          {referendum.trackId != null && (
            <span className="text-[11px] text-muted-foreground">
              {fellowshipTrackCaption(track, referendum.trackId)}
            </span>
          )}
        </div>
        <span className="text-xs font-mono text-muted-foreground">F#{referendum.index}</span>
      </div>
      <p className="font-semibold text-foreground text-sm truncate">
        {callName ?? `Fellowship referendum F#${referendum.index}`}
      </p>
      {ayePct != null ? (
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-green-700 dark:text-green-400 font-medium">{ayePct}% Aye</span>
            <span className="text-red-700 dark:text-red-400 font-medium">{100 - ayePct}% Nay</span>
          </div>
          <div className="h-1.5 rounded-full bg-red-500/60 overflow-hidden">
            <div className="h-full bg-green-500" style={{ width: `${ayePct}%` }} />
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1">
          <Users className="w-3 h-3" />
          {referendum.status.type === "Ongoing" ? "No votes yet" : "Decided"}
        </p>
      )}
    </Link>
  )
}

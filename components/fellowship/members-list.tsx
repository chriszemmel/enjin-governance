"use client"

import { useState } from "react"
import { UserChip } from "@/components/profile/user-chip"
import { samePublicKey } from "@/lib/chain/ss58"
import {
  fellowshipTrackLabel,
  MAX_RANK,
  rankNumeral,
  voteWeight,
  type FellowshipMember,
} from "@/lib/governance/fellowship"
import type { Track } from "@/lib/governance/types"
import { cn } from "@/lib/utils"
import { RankBadge } from "./rank-badge"

/**
 * The live roster: each member's rank and what their vote counts on the
 * selected track. Members below the track's minimum rank count 0.
 */
export function MembersList({
  members,
  tracks,
  me,
}: {
  members: FellowshipMember[]
  tracks: Track[]
  me: string | null
}) {
  const [trackId, setTrackId] = useState(3)
  const counts = Array.from(
    { length: MAX_RANK + 1 },
    (_, r) => members.filter((m) => m.rank === r).length,
  )
  const track = tracks.find((t) => t.id === trackId) ?? null

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1">
          {counts
            .map((n, r) => ({ n, r }))
            .reverse()
            .map(({ n, r }) => (
              <span
                key={r}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded-full border tabular-nums",
                  n > 0
                    ? "border-purple-border bg-primary/8 text-foreground font-semibold"
                    : "border-border text-muted-foreground/60",
                )}
              >
                {rankNumeral(r)} {n}
              </span>
            ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Weight on
          <select
            value={trackId}
            onChange={(e) => setTrackId(Number(e.target.value))}
            className="rounded-lg bg-surface-1 border border-border px-2 py-1 text-xs text-foreground"
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {fellowshipTrackLabel(t, t.id)} (rank {rankNumeral(t.id)}+)
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="px-4 py-2.5 border-b border-border grid grid-cols-[1fr_auto_3rem] sm:grid-cols-[1fr_12rem_8rem] gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Member</span>
        <span>Rank</span>
        <span className="text-right truncate">
          Weight
          <span className="hidden sm:inline">
            {" "}
            on {track ? fellowshipTrackLabel(track, trackId) : "track"}
          </span>
        </span>
      </div>
      <ul className="divide-y divide-border">
        {members.map((m) => {
          const mine = !!me && samePublicKey(m.address, me)
          return (
            <li
              key={m.address}
              className={cn(
                "px-4 py-3 grid grid-cols-[1fr_auto_3rem] sm:grid-cols-[1fr_12rem_8rem] gap-3 items-center",
                mine && "bg-primary/5",
              )}
            >
              <div className="min-w-0 flex items-center gap-2">
                <UserChip address={m.address} size="sm" />
                {mine && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                    you
                  </span>
                )}
              </div>
              <div>
                <RankBadge rank={m.rank} />
              </div>
              <span className="text-right font-mono text-sm font-semibold text-foreground tabular-nums">
                {voteWeight(m.rank, trackId)}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="px-4 py-2.5 border-t border-border text-[11px] text-muted-foreground">
        Live from <code>fellowshipCollective.members</code>. A member counts (r + 1)(r + 2) / 2 on
        {track ? ` ${fellowshipTrackLabel(track, trackId)}` : " a track"}, r being their rank above
        its minimum; members below it can&apos;t vote there.
      </p>
    </div>
  )
}

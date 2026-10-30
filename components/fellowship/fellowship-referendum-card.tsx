"use client"

import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"
import { StatusChip } from "@/components/governance/status-chip"
import { LifecycleMini } from "@/components/governance/lifecycle-progress"
import { formatRelativeBlockTime } from "@/lib/chain/format"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  FELLOWSHIP_PALLET,
  fellowshipTrackCaption,
  trackMinRank,
  type FellowshipReferendum,
} from "@/lib/governance/fellowship"
import type { Track } from "@/lib/governance/types"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import { useMyFellowshipVote } from "@/lib/query/hooks/use-fellowship"
import { useReferendumHistory } from "@/lib/query/hooks/use-referendum-history"
import { useWhitelistLink } from "@/lib/query/hooks/use-whitelist"
import { useDecodedCall } from "./call-summary"

/**
 * A fellowship referendum in the hub's list: status, rank track and F#,
 * what it does, the rank-weighted split and where it stands, and what the
 * connected member has to do with it.
 */
export function FellowshipReferendumCard({
  referendum,
  tracks,
  myAddress,
  myRank,
  title: egovTitle,
}: {
  referendum: FellowshipReferendum
  /** The fellowship track table; a decided referendum's track comes from its history. */
  tracks: Track[]
  myAddress: string | null
  myRank: number | null
  /** The EGOV1 title, when it has one; else the call names it. */
  title: string | null
}) {
  const chain = useActiveChain()
  const currentBlock = useCurrentBlock().data ?? null
  const status = referendum.status
  const ongoing = status.type === "Ongoing" ? status : null
  const decidedAt = ongoing ? null : "at" in status ? status.at : null
  const history = useReferendumHistory(
    referendum.index,
    decidedAt,
    undefined,
    FELLOWSHIP_PALLET,
  ).data
  const source = ongoing ? referendum : history
  const trackId = referendum.trackId ?? history?.trackId ?? null
  const track = tracks.find((t) => t.id === trackId) ?? null
  const decoded = useDecodedCall(source, decidedAt ? decidedAt - 1 : null)
  const bytes =
    source?.status.type === "Ongoing" && "type" in source.status.proposal
      ? source.status.proposal.bytes
      : decoded?.bytes
  const { counterparts } = useWhitelistLink(bytes)
  const publicRef = counterparts.data?.find((c) => c.pallet === "referenda") ?? null
  const myVote = useMyFellowshipVote(referendum.index, ongoing ? myAddress : null).data ?? null
  const eligible = myRank != null && trackId != null && myRank >= trackMinRank(trackId)

  const title =
    egovTitle ??
    (decoded ? `${decoded.section}.${decoded.method}` : `Fellowship referendum F#${referendum.index}`)
  const tally = referendum.rankedTally
  const total = tally ? tally.ayes + tally.nays : 0
  const ayePct = tally && total > 0 ? Math.round((tally.ayes / total) * 100) : null
  const submitted =
    ongoing?.submitted ?? (history?.status.type === "Ongoing" ? history.status.submitted : null)

  return (
    <Link
      href={`/fellowship/${referendum.index}?network=${chain.id}`}
      className="flex flex-col rounded-2xl bg-card border border-border p-5 hover:border-purple-border transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusChip type={status.type} />
          {trackId != null && (
            <span className="text-[11px] text-muted-foreground">
              {fellowshipTrackCaption(track, trackId)}
            </span>
          )}
        </div>
        <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
          F # {referendum.index}
        </span>
      </div>
      <p className="font-semibold text-foreground mt-3 break-words">{title}</p>

      {ongoing && ayePct != null && (
        <div className="mt-3 space-y-1.5">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-green-700 dark:text-green-400">{ayePct}% Aye</span>
            <span className="text-red-700 dark:text-red-400">{100 - ayePct}% Nay</span>
          </div>
          <div className="flex h-1.5 gap-0.5 rounded-full overflow-hidden">
            <div className="bg-green-500 rounded-full" style={{ width: `${ayePct}%` }} />
            <div className="bg-red-400 rounded-full flex-1" />
          </div>
        </div>
      )}
      {ongoing && (
        <LifecycleMini
          referendum={referendum}
          track={track}
          pallet={FELLOWSHIP_PALLET}
          className="mt-4"
        />
      )}

      <div className="mt-auto pt-4 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {ongoing
            ? submitted != null
              ? `Submitted ${formatRelativeBlockTime(submitted, currentBlock)}`
              : "Submitted"
            : decidedAt != null
              ? `${status.type === "Approved" ? "Approved" : "Ended"} ${formatRelativeBlockTime(decidedAt, currentBlock)}`
              : "Ended"}
        </span>
        {ongoing && myVote ? (
          <span
            className={
              myVote.aye
                ? "inline-flex items-center gap-1 text-green-700 dark:text-green-400 font-medium"
                : "inline-flex items-center gap-1 text-red-700 dark:text-red-400 font-medium"
            }
          >
            <Check className="w-3.5 h-3.5" />
            You voted {myVote.aye ? "Aye" : "Nay"}
          </span>
        ) : ongoing && eligible ? (
          <span className="inline-flex items-center gap-1 text-primary font-medium">
            Your vote is open <ArrowRight className="w-3.5 h-3.5" />
          </span>
        ) : publicRef ? (
          <span className="inline-flex items-center gap-1 text-primary font-medium">
            Public referendum #{publicRef.index} <ArrowRight className="w-3.5 h-3.5" />
          </span>
        ) : null}
      </div>
    </Link>
  )
}

"use client"

import Link from "next/link"
import { Ban, Hash } from "lucide-react"
import { cn } from "@/lib/utils"
import { useActiveChain } from "@/lib/chain/use-chain"
import type { Referendum, Track } from "@/lib/governance/types"
import { StatusChip } from "./status-chip"
import {
  type ProposalMetadata,
  useProposalMetadata,
} from "@/lib/query/hooks/use-proposal-metadata"
import { BlockTime } from "./block-time"
import { TrackBadge } from "./track-badge"
import { TallyBar } from "./tally-bar"
import { LifecycleMini } from "./lifecycle-progress"
import { formatTokenAmount } from "@/lib/chain/format"
import { intentFromPreimage } from "@/lib/governance/call-extract"
import { localSpendTarget } from "@/lib/governance/payout"
import { useInlineCall, usePreimage } from "@/lib/query/hooks/use-preimage"

interface ProposalCardProps {
  referendum: Referendum
  track?: Track | null
  className?: string
  /**
   * Pre-fetched metadata. Supplied by list pages that batch all cards in
   * one `/api/proposals/by-indices` request - omit for single-card use
   * and the card falls back to its own per-index request.
   */
  metadata?: ProposalMetadata | null
  /**
   * From a batching list: whether the metadata batch is still loading. Lets
   * the card hold a title skeleton instead of flashing "Referendum #N" before
   * a real title arrives. Ignored for single-card use (it tracks its own query).
   */
  metadataPending?: boolean
}

export function ProposalCard({
  referendum,
  track,
  className,
  metadata,
  metadataPending,
}: ProposalCardProps) {
  const chain = useActiveChain()
  const { index, status, tally, trackId } = referendum
  const metadataQuery = useProposalMetadata(metadata === undefined ? index : null)
  const data = metadata === undefined ? metadataQuery.data : metadata
  const title = data?.title
  // Until the metadata lookup settles we don't know whether this referendum
  // has a title, so hold a skeleton rather than flashing the index fallback.
  // Once it resolves (title found, or no metadata), show the title or the index.
  const metaPending =
    metadata === undefined ? metadataQuery.isLoading : (metadataPending ?? false)
  // Proposer has flagged the off-chain submission as withdrawn. On-chain
  // voting may still be open - the marker is purely a "don't trust this
  // anymore" signal from the author, mirrored on the detail page's banner.
  const isWithdrawn = data?.withdrawn_at != null

  // Submitted while ongoing; once decided, the block it ended at.
  const submittedBlock = status.type === "Ongoing" ? status.submitted : status.at
  const isOngoing = status.type === "Ongoing"
  const spendAmount = useSpendAmount(referendum)

  return (
    <Link
      href={`/proposals/${index}?network=${chain.id}`}
      className={cn(
        "block rounded-2xl border border-border bg-card p-5 transition-colors duration-200",
        "hover:border-muted-foreground/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChip type={status.type} />
          <TrackBadge track={track ?? null} trackId={trackId} />
          {isWithdrawn && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-destructive/40 bg-destructive/10 text-destructive uppercase tracking-wide"
              title="The proposer flagged this submission as withdrawn"
            >
              <Ban className="w-3 h-3" />
              Withdrawn
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground font-mono flex items-center gap-1 flex-shrink-0">
          <Hash className="w-3 h-3" />
          {index}
        </span>
      </div>

      <h3
        className={cn(
          "text-base font-semibold leading-snug mb-3 line-clamp-2 [overflow-wrap:anywhere]",
          isWithdrawn
            ? "text-muted-foreground line-through decoration-destructive/60 decoration-1"
            : "text-foreground",
        )}
      >
        {metaPending ? (
          <span className="inline-block h-5 w-2/3 max-w-[16rem] rounded bg-surface-3 animate-pulse align-middle" />
        ) : (
          (title ?? `Referendum #${index}`)
        )}
      </h3>

      {/* Only render the tally row when we have one. Terminal referenda
          drop the tally from on-chain state - the status badge above
          already conveys the outcome. */}
      {tally && (
        <div className="mb-4">
          <TallyBar tally={tally} compact />
        </div>
      )}

      {/* An Approved referendum's call still waits in the scheduler until
          it's enacted; the bar shows that too, then hides itself. */}
      {(isOngoing || status.type === "Approved") && (
        <LifecycleMini
          referendum={referendum}
          track={track ?? null}
          amount={spendAmount}
          className="mb-4"
        />
      )}

      {/* An Approved card's line above already dates it. */}
      {status.type !== "Approved" && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            {isOngoing ? "Submitted" : "Ended"} <BlockTime block={submittedBlock} />
          </span>
        </div>
      )}
    </Link>
  )
}

/**
 * What a live treasury spend_local pays, decoded from its call on chain
 * (the preimage, or the inline call) - never from the off-chain metadata,
 * whose amount the proposer typed. Null for any other call.
 */
function useSpendAmount(referendum: Referendum): string | null {
  const chain = useActiveChain()
  const proposal = referendum.status.type === "Ongoing" ? referendum.status.proposal : null
  const inline = proposal && "type" in proposal && proposal.type === "Inline" ? proposal.bytes : null
  const lookup = proposal && !inline ? (proposal as { hash: `0x${string}`; len: number }) : null
  const preimage = usePreimage(lookup)
  const inlineCall = useInlineCall(inline)
  const decoded = preimage.data?.section ? preimage.data : inlineCall.data
  const target = decoded?.section ? localSpendTarget(intentFromPreimage(decoded, chain)) : null
  return target ? formatTokenAmount(target.amount, chain, { maxFractionDigits: 2 }) : null
}

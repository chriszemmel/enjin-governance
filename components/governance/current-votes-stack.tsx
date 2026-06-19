"use client"

import { useCallback, useEffect, useState } from "react"
import useEmblaCarousel from "embla-carousel-react"
import { ChevronLeft, ChevronRight, Lock, Pencil, Trash2 } from "lucide-react"
import type { ChainConfig } from "@/lib/chain/chains"
import { formatBlockDuration, formatTokenAmount } from "@/lib/chain/format"
import { sEnjCurrency, type VoteCurrency } from "@/lib/governance/conviction-voting"
import {
  CONVICTION_LOCK_PERIODS,
  CONVICTION_MULTIPLIER,
} from "@/lib/governance/types"
import type { MyVoteOnPoll } from "@/lib/governance/conviction-voting"
import { decodeCurrency } from "@/lib/governance/vote-decode"
import { usePoolNft } from "@/lib/query/hooks/use-pool-nft"
import { cn } from "@/lib/utils"
import { EnjAvatar } from "./enj-avatar"
import { PoolNftAvatar } from "./pool-nft-avatar"

type Props = {
  votes: MyVoteOnPoll[]
  chain: ChainConfig
  decisionPeriodBlocks: number | null
  removing: boolean
  removeStatus: string
  canRemove: boolean
  /** Whether the vote can still be changed (referendum ongoing). When false
   *  the only action is removing it to free the lock. */
  editable: boolean
  /** Currency currently being removed (matched against each card's source). */
  removingCurrency: VoteCurrency | null
  onRemove: (currency: VoteCurrency) => void
}

/**
 * Renders every vote the wallet has cast on this poll, one card per
 * currency source (liquid ENJ + each sENJ pool the user voted with).
 * One vote => single card, 2+ => embla swiper with dot indicators.
 *
 * The remove button on each card passes its own currency upstream,
 * so removing your sENJ pool #59 vote doesn't accidentally touch
 * the ENJ vote on the same referendum.
 */
export function CurrentVotesStack({
  votes,
  chain,
  decisionPeriodBlocks,
  removing,
  removeStatus,
  canRemove,
  editable,
  removingCurrency,
  onRemove,
}: Props) {
  // Embla setup mirrors TallyVotesSwiper but is leaner: a single
  // horizontal carousel, dots only (no arrow buttons, no header
  // tabs). Skipped entirely for the single-vote case.
  const multi = votes.length > 1
  const [emblaRef, embla] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    loop: false,
  })
  const [selected, setSelected] = useState(0)
  const onSelect = useCallback(() => {
    if (!embla) return
    setSelected(embla.selectedScrollSnap())
  }, [embla])
  useEffect(() => {
    if (!embla || !multi) return
    onSelect()
    embla.on("select", onSelect)
    embla.on("reInit", onSelect)
    return () => {
      embla.off("select", onSelect)
      embla.off("reInit", onSelect)
    }
  }, [embla, multi, onSelect])
  const scrollTo = useCallback(
    (idx: number) => embla?.scrollTo(idx),
    [embla],
  )

  if (votes.length === 0) return null

  if (!multi) {
    const v = votes[0]!
    return (
      <div className="px-5 pt-4">
        <Card
          entry={v}
          chain={chain}
          decisionPeriodBlocks={decisionPeriodBlocks}
          removing={removing && currencyMatches(v, removingCurrency)}
          removeStatus={removeStatus}
          canRemove={canRemove}
          editable={editable}
          onRemove={onRemove}
        />
      </div>
    )
  }

  return (
    <div className="pt-4">
      <div className="px-5 mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Your votes
        </p>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {selected + 1} / {votes.length}
        </span>
      </div>
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {votes.map((entry, i) => (
            <div
              key={cardKey(entry, i)}
              className="flex-[0_0_100%] min-w-0 px-5"
            >
              <Card
                entry={entry}
                chain={chain}
                decisionPeriodBlocks={decisionPeriodBlocks}
                removing={removing && currencyMatches(entry, removingCurrency)}
                removeStatus={removeStatus}
                canRemove={canRemove}
                editable={editable}
                onRemove={onRemove}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="px-5 mt-3 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => scrollTo(Math.max(0, selected - 1))}
          disabled={selected === 0}
          aria-label="Previous vote"
          className="w-6 h-6 inline-flex items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-purple-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
        {votes.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Vote ${i + 1}`}
            className={cn(
              "h-1.5 rounded-full transition-all",
              selected === i ? "w-5 bg-primary" : "w-1.5 bg-border",
            )}
          />
        ))}
        <button
          type="button"
          onClick={() => scrollTo(Math.min(votes.length - 1, selected + 1))}
          disabled={selected === votes.length - 1}
          aria-label="Next vote"
          className="w-6 h-6 inline-flex items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-purple-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

function Card({
  entry,
  chain,
  decisionPeriodBlocks,
  removing,
  removeStatus,
  canRemove,
  editable,
  onRemove,
}: {
  entry: MyVoteOnPoll
  chain: ChainConfig
  decisionPeriodBlocks: number | null
  removing: boolean
  removeStatus: string
  canRemove: boolean
  editable: boolean
  onRemove: (currency: VoteCurrency) => void
}) {
  const decoded = decodeCurrency(entry.currencyRaw)
  const isSEnj = decoded.kind === "SEnj"
  const poolId = decoded.kind === "SEnj" ? decoded.poolId : null
  const poolNft = usePoolNft(poolId)
  // Prefer the staking pool's name ("Substreak") over its id; fall back to
  // "Pool #N" while the name resolves or if the pool has none on chain.
  const sourceLabel =
    decoded.kind === "SEnj"
      ? `sENJ · ${poolNft.data?.pool.name ?? `Pool #${decoded.poolId}`}`
      : "ENJ"
  const tokenLabel = isSEnj ? "sENJ" : chain.ticker
  const currency: VoteCurrency = isSEnj
    ? sEnjCurrency(decoded.poolId)
    : { Enj: null }

  const removeLabel = removing
    ? removeStatus === "signing"
      ? "Signing…"
      : removeStatus === "broadcast"
        ? "Broadcasting…"
        : removeStatus === "in-block"
          ? "In block…"
          : "Removing…"
    : "Remove"

  if (entry.vote.type !== "Standard") {
    return (
      <div className="rounded-xl bg-surface-1 border border-border p-3 text-xs text-muted-foreground space-y-2">
        <div className="flex items-center gap-2">
          {isSEnj ? (
            <PoolNftAvatar poolId={decoded.poolId} size="sm" />
          ) : (
            <EnjAvatar size="sm" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">
              {sourceLabel}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Non-standard vote on chain.
            </p>
          </div>
        </div>
        <p>
          Submitting below replaces this with a Standard vote. Removing
          withdraws it from the tally.
        </p>
        <RemoveButton
          onClick={() => onRemove(currency)}
          disabled={!canRemove || removing}
          removing={removing}
          label={removeLabel}
        />
      </div>
    )
  }

  const v = entry.vote
  const multiplier = CONVICTION_MULTIPLIER[v.conviction]
  const lockPeriods = CONVICTION_LOCK_PERIODS[v.conviction]
  const lockLabel =
    v.conviction === "None"
      ? "No lock"
      : decisionPeriodBlocks != null
        ? formatBlockDuration(decisionPeriodBlocks * lockPeriods)
        : `${lockPeriods} decision periods`

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-3.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isSEnj ? (
            <PoolNftAvatar poolId={decoded.poolId} size="sm" />
          ) : (
            <EnjAvatar size="sm" />
          )}
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Voted with
            </p>
            <p className="text-xs font-medium text-foreground truncate">
              {sourceLabel}
            </p>
          </div>
        </div>
        {editable ? (
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1",
              v.aye ? "text-emerald-400" : "text-red-400",
            )}
          >
            <Pencil className="w-2.5 h-2.5" />
            Editable
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1 text-muted-foreground">
            <Lock className="w-2.5 h-2.5" />
            Closed
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2 flex-wrap pt-1">
        <span
          className={cn(
            "text-base font-semibold",
            v.aye ? "text-emerald-400" : "text-red-400",
          )}
        >
          {v.aye ? "Aye" : "Nay"}
        </span>
        <span className="font-mono text-sm text-foreground">
          {formatTokenAmount(v.balance, chain, {
            maxFractionDigits: 2,
            withTicker: false,
          })}{" "}
          {tokenLabel}
        </span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Lock className="w-3 h-3" />
          {lockLabel}
        </span>
        <span className="font-mono">{multiplier}x</span>
      </div>
      <div className="pt-2 border-t border-border flex items-center justify-end">
        <RemoveButton
          onClick={() => onRemove(currency)}
          disabled={!canRemove || removing}
          removing={removing}
          label={removeLabel}
        />
      </div>
    </div>
  )
}

function RemoveButton({
  onClick,
  disabled,
  removing,
  label,
}: {
  onClick: () => void
  disabled: boolean
  removing: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      title="Withdraw this vote on chain"
    >
      {removing ? (
        <span className="w-3 h-3 rounded-full border border-muted-foreground border-t-transparent animate-spin" />
      ) : (
        <Trash2 className="w-3 h-3" />
      )}
      {label}
    </button>
  )
}

/** Stable React key for an entry - currency + vote shape suffices. */
function cardKey(entry: MyVoteOnPoll, fallback: number): string {
  const decoded = decodeCurrency(entry.currencyRaw)
  if (decoded.kind === "SEnj") return `senj-${decoded.poolId}`
  if (decoded.kind === "Enj") return "enj"
  return `unknown-${fallback}`
}

function currencyMatches(
  entry: MyVoteOnPoll,
  target: VoteCurrency | null,
): boolean {
  if (!target) return false
  const decoded = decodeCurrency(entry.currencyRaw)
  if ("Enj" in target) return decoded.kind === "Enj" || decoded.kind === "Unknown"
  const targetId = Number(target.SEnj.tokenId)
  return decoded.kind === "SEnj" && decoded.poolId === targetId
}
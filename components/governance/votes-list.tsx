"use client"

import { useMemo, useState } from "react"
import { ChevronRight, Lock, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { Bar } from "./skeletons"
import { type ChainConfig } from "@/lib/chain/chains"
import { formatBlockDuration, formatTokenAmount } from "@/lib/chain/format"
import {
  encodeForChain,
  encodePublicKeyForChain,
  shortenAddress,
} from "@/lib/chain/ss58"
import {
  type ReferendumVote,
  useReferendumVotes,
} from "@/lib/query/hooks/use-referendum-votes"
import { useReferendumVoteExtrinsics } from "@/lib/query/hooks/use-referendum-vote-extrinsics"
import { usePrefetchPoolNfts } from "@/lib/query/hooks/use-prefetch-pool-nfts"
import {
  convictionLockBlocks,
  getVoteLockingPeriod,
} from "@/lib/governance/conviction-voting"
import {
  decodeCurrency,
  decodeVote,
  formatCurrencyLabel,
} from "@/lib/governance/vote-decode"
import { type Conviction } from "@/lib/governance/types"
import { useApi } from "@/lib/query/hooks/use-api"
import { EnjAvatar } from "./enj-avatar"
import { PoolNftAvatar } from "./pool-nft-avatar"
import { VoteDetailModal } from "./vote-detail-modal"

/**
 * Subscan returns voter addresses as either SS58 or a 0x-pubkey
 * depending on tier. Normalise both to the active chain's SS58 prefix
 * for display.
 */
function normaliseVoterAddress(addr: string, chain: ChainConfig): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(addr)) {
    try {
      return encodePublicKeyForChain(addr, chain.id)
    } catch {
      return addr
    }
  }
  try {
    return encodeForChain(addr, chain.id)
  } catch {
    return addr
  }
}

interface VotesListProps {
  referendumIndex: number
  chain: ChainConfig
}

export function VotesList({
  referendumIndex,
  chain,
}: VotesListProps) {
  const query = useReferendumVotes(referendumIndex)
  // Conviction locks run in the runtime's voteLockingPeriod on every track.
  const voteLockingPeriod = getVoteLockingPeriod(useApi(chain).data)
  const extrinsics = useReferendumVoteExtrinsics(referendumIndex, chain)
  const [expanded, setExpanded] = useState(false)

  // Warm the pool-NFT cache for every sENJ vote in this referendum
  // before the user expands "Show more" - the thumbnails are then
  // already painted by the time their rows mount.
  const poolIds = useMemo(() => {
    const out: number[] = []
    for (const row of query.data ?? []) {
      const c = decodeCurrency(row.currencyRaw)
      if (c.kind === "SEnj") out.push(c.poolId)
    }
    return out
  }, [query.data])
  usePrefetchPoolNfts(poolIds, chain)

  if (query.isPending) {
    return (
      <div className="space-y-1.5 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  const rows = query.data
  if (!rows || rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        No votes have been cast on this referendum yet. Once someone
        votes, their entry appears here within a block or two.
      </p>
    )
  }

  const visible = expanded ? rows : rows.slice(0, 5)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Users className="w-3 h-3" />
          {rows.length} vote{rows.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="space-y-1.5">
        {visible.map((row) => {
          const subscan = extrinsics.data?.get(row.voter) ?? null
          // A voter can hold one row per (track, currency) - liquid ENJ and an
          // sENJ pool on the same track are distinct rows. Key on currency too
          // so neither collapses into the other.
          const c = decodeCurrency(row.currencyRaw)
          const curKey = c.kind === "SEnj" ? `senj-${c.poolId}` : c.kind
          return (
            <VoteRow
              key={`${row.voter}-${row.trackId}-${curKey}`}
              row={row}
              chain={chain}
              voteLockingPeriod={voteLockingPeriod}
              extrinsicIndex={subscan?.extrinsicIndex ?? null}
              subscanCurrencyRaw={subscan?.currencyRaw ?? null}
            />
          )
        })}
      </div>
      {rows.length > 5 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center py-1.5"
        >
          {expanded ? "Show fewer" : `Show ${rows.length - 5} more`}
        </button>
      )}
    </div>
  )
}

function VoteRow({
  row,
  chain,
  voteLockingPeriod,
  extrinsicIndex,
  subscanCurrencyRaw,
}: {
  row: ReferendumVote
  chain: ChainConfig
  /** The runtime's conviction-lock unit (`getVoteLockingPeriod`), in blocks. */
  voteLockingPeriod: number
  /** Subscan-sourced "<block>-<event>" identifier for the vote extrinsic. */
  extrinsicIndex: string | null
  /** Subscan-sourced currency payload, used when the chain query came back null. */
  subscanCurrencyRaw: unknown
}) {
  const decoded = decodeVote(row.voteRaw)
  // If Subscan handed us an explicit conviction separately (label-style
  // vote field), override the default Locked1x guess.
  const conviction: Conviction | null = (() => {
    if (decoded && typeof row.convictionRaw === "number") {
      const map = [
        "None",
        "Locked1x",
        "Locked2x",
        "Locked3x",
        "Locked4x",
        "Locked5x",
        "Locked6x",
      ] as const
      return map[Math.min(row.convictionRaw, map.length - 1)] ?? decoded.conviction
    }
    return decoded?.conviction ?? null
  })()
  const aye = decoded?.aye ?? null
  const multiplier = decoded?.multiplier ?? null
  // Prefer the chain-sourced currency, but fall back to Subscan's when
  // the chain returned null (storage-key-order quirk, voter manager
  // not populated, etc.). Either source produces the same decoded
  // shape; the row never sees mixed sources.
  const chainCurrency = decodeCurrency(row.currencyRaw)
  const currency =
    chainCurrency.kind === "Unknown"
      ? decodeCurrency(subscanCurrencyRaw)
      : chainCurrency
  const lockBlocks = conviction != null ? convictionLockBlocks(conviction, voteLockingPeriod) : 0
  const lockLabel =
    conviction === "None"
      ? "No lock"
      : lockBlocks > 0
        ? formatBlockDuration(lockBlocks)
        : null

  const displayVoter = row.voter
    ? normaliseVoterAddress(row.voter, chain)
    : null

  // Tint the entire row card by verdict - green for aye, red for nay -
  // so the avatars stay clean circles instead of carrying a coloured
  // ring. Hover states stay tonal to keep the affordance visible.
  const cardTone =
    aye === true
      ? "border-green-500/30 bg-green-500/5 hover:bg-green-500/10 hover:border-green-500/50"
      : aye === false
        ? "border-red-500/30 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/50"
        : "border-border bg-surface-1 hover:bg-surface-2 hover:border-purple-border"

  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!displayVoter}
        className={cn(
          "w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
          displayVoter
            ? cn(
                cardTone,
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              )
            : "border-border bg-surface-1 opacity-70 cursor-default",
        )}
      >
        {currency.kind === "SEnj" ? (
          <PoolNftAvatar poolId={currency.poolId} size="sm" />
        ) : (
          <EnjAvatar size="sm" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-foreground truncate">
              {displayVoter
                ? shortenAddress(displayVoter)
                : "Unknown voter"}
            </span>
            {multiplier != null && (
              <span className="text-[10px] text-primary font-semibold">
                {multiplier}x
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
            <span className="font-mono tabular-nums">
              {formatTokenAmount(row.balance, chain, {
                maxFractionDigits: 2,
                withTicker: false,
              })}
            </span>
            <CurrencyBadge currency={currency} />
            {lockLabel && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  {lockLabel} lock
                </span>
              </>
            )}
          </div>
        </div>

        {displayVoter && (
          <ChevronRight
            className="w-4 h-4 text-muted-foreground flex-shrink-0"
            aria-hidden
          />
        )}
      </button>

      {displayVoter && (
        <VoteDetailModal
          open={open}
          onOpenChange={setOpen}
          chain={chain}
          voter={displayVoter}
          aye={aye}
          conviction={conviction}
          multiplier={multiplier}
          lockBlocks={lockBlocks}
          balance={row.balance}
          currency={currency}
          extrinsicIndex={extrinsicIndex}
        />
      )}
    </>
  )
}

/**
 * Currency label for the overview row. Kept deliberately minimal:
 * the NFT thumbnail to the left already conveys which staking pool
 * cast the vote, so the text just identifies the currency family.
 * The pool's friendly name, index, and NFT name all live in the
 * vote-detail modal.
 */
function CurrencyBadge({
  currency,
}: {
  currency: ReturnType<typeof decodeCurrency>
}) {
  if (currency.kind === "SEnj") {
    return <span>sENJ</span>
  }
  return <span>{formatCurrencyLabel(currency)}</span>
}

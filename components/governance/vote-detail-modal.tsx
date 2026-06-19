"use client"

import { Check, Copy, ExternalLink, Lock, X } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  type ChainConfig,
  stakingPoolUrl,
  subscanAccountUrl,
  subscanExtrinsicUrl,
} from "@/lib/chain/chains"
import { formatBlockDuration, formatTokenAmount } from "@/lib/chain/format"
import { type decodeCurrency } from "@/lib/governance/vote-decode"
import { type Conviction } from "@/lib/governance/types"
import { usePoolNft } from "@/lib/query/hooks/use-pool-nft"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { UserChip } from "@/components/profile/user-chip"
import { EnjAvatar } from "./enj-avatar"
import { PoolNftAvatar } from "./pool-nft-avatar"

interface VoteDetailModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: ChainConfig
  voter: string
  aye: boolean | null
  conviction: Conviction | null
  multiplier: number | null
  lockPeriods: number
  decisionPeriodBlocks: number | null
  balance: bigint
  currency: ReturnType<typeof decodeCurrency>
  extrinsicIndex: string | null
}

/**
 * Per-vote detail modal. Surfaces every field the truncated list row
 * had to elide (full voter address, full balance, vote-extrinsic
 * reference) along with a copy button for each, plus links out to
 * Subscan for the account and the specific vote extrinsic.
 */
export function VoteDetailModal({
  open,
  onOpenChange,
  chain,
  voter,
  aye,
  conviction,
  multiplier,
  lockPeriods,
  decisionPeriodBlocks,
  balance,
  currency,
  extrinsicIndex,
}: VoteDetailModalProps) {
  const lockBlocks = decisionPeriodBlocks != null ? decisionPeriodBlocks * lockPeriods : 0
  const lockLabel =
    conviction === "None"
      ? "No lock"
      : decisionPeriodBlocks != null && lockBlocks > 0
        ? formatBlockDuration(lockBlocks)
        : "-"

  const verdictLabel = aye === true ? "Aye" : aye === false ? "Nay" : "Vote"
  const verdictIcon =
    aye === true ? (
      <Check className="w-4 h-4 text-green-400" aria-hidden />
    ) : aye === false ? (
      <X className="w-4 h-4 text-red-400" aria-hidden />
    ) : (
      <Lock className="w-4 h-4 text-muted-foreground" aria-hidden />
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-3rem)] max-w-[calc(100%-3rem)] sm:max-w-md p-6 sm:p-8 gap-5 rounded-2xl">
        <DialogHeader>
          {/* Header is a stacked centred block - avatar above, the
              balance as the prominent headline, and verdict + multiplier
              as a quiet caption below. Centering keeps the eye anchored
              on the amount instead of bouncing between corners. */}
          <div className="flex flex-col items-center text-center gap-3 pt-2">
            {currency.kind === "SEnj" ? (
              <PoolNftAvatar poolId={currency.poolId} size="lg" />
            ) : (
              <EnjAvatar size="lg" />
            )}
            <div className="space-y-1">
              <DialogTitle
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  aye === true
                    ? "text-green-400"
                    : aye === false
                      ? "text-red-400"
                      : "text-foreground",
                )}
              >
                {formatTokenAmount(balance, chain, {
                  maxFractionDigits: 4,
                })}
              </DialogTitle>
              <p className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground">
                {verdictIcon}
                <span className="font-medium text-foreground">{verdictLabel}</span>
                {multiplier != null && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="text-primary font-semibold">
                      {multiplier}x Conviction
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Voter
            </p>
            <UserChip address={voter} size="md" />
            <DetailField label="" mono value={voter} copyable hideLabel />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StaticField label="Conviction" value={`${multiplier ?? "-"}x`} />
            <StaticField label="Lock duration" value={lockLabel} />
          </div>

          {currency.kind === "SEnj" && (
            <SEnjPoolDetail poolId={currency.poolId} chain={chain} />
          )}

          {extrinsicIndex && (
            <DetailField
              label="Vote extrinsic"
              mono
              copyable
              value={extrinsicIndex}
            />
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={subscanAccountUrl(chain, voter)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium"
            >
              <ExternalLink className="w-3 h-3" />
              View Account on Subscan
            </a>
            {extrinsicIndex && (
              <a
                href={subscanExtrinsicUrl(chain, extrinsicIndex)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium ml-auto"
              >
                <ExternalLink className="w-3 h-3" />
                View Vote Extrinsic
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Read-only field for short labels (conviction, lock duration, cast
 * time, block) that nobody needs to copy. Keeps the modal scannable
 * by reserving the copy affordance for fields where it's actually
 * useful (the voter address and the extrinsic id).
 */
function StaticField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  )
}

function DetailField({
  label,
  value,
  mono = false,
  copyable = false,
  hideLabel = false,
}: {
  label: string
  value: string
  mono?: boolean
  /** Renders the copy affordance - leave off for short read-only values. */
  copyable?: boolean
  /** Suppress the label row - used when a parent already renders one. */
  hideLabel?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch {
      // clipboard unavailable - degrade silently
    }
  }
  return (
    <div className="space-y-1">
      {!hideLabel && (
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      )}
      <div className="flex items-start gap-2">
        <p
          className={cn(
            "text-sm text-foreground break-all flex-1 min-w-0",
            mono && "font-mono",
          )}
        >
          {value}
        </p>
        {copyable && (
          <button
            type="button"
            onClick={copy}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5"
            aria-label={`Copy ${label.toLowerCase()}`}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function SEnjPoolDetail({
  poolId,
  chain,
}: {
  poolId: number
  chain: ChainConfig
}) {
  const query = usePoolNft(poolId)
  const data = query.data
  const poolName = data?.pool.name ?? null
  const nftName = data?.metadata?.name ?? null

  // Primary line: the NFT identity ("Degen #2") - that's the brand a
  // holder recognises. Fall back to the explicit pool id when the
  // metadata is still loading or absent.
  const primary = nftName ?? `Pool ID #${poolId}`

  // Secondary line: the on-chain pool name ("Substreak") plus the
  // pool id. When the pool has no on-chain name, just the id.
  const secondary = poolName
    ? `${poolName} · Pool ID #${poolId}`
    : `Pool ID #${poolId}`

  const poolUrl = stakingPoolUrl(chain, poolId)

  return (
    <div className="rounded-xl bg-surface-2 border border-border p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Staking pool
      </p>
      <div className="flex items-center gap-3">
        <PoolNftAvatar poolId={poolId} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {primary}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {secondary}
          </p>
        </div>
      </div>
      {poolUrl && (
        <a
          href={poolUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80"
        >
          <ExternalLink className="w-3 h-3" />
          View Pool on NFT.io
        </a>
      )}
    </div>
  )
}

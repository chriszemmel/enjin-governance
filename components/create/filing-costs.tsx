"use client"

import { Coins } from "lucide-react"
import type { ChainConfig } from "@/lib/chain/chains"
import { formatTokenAmount } from "@/lib/chain/format"
import type { FilingRequirement } from "@/lib/governance/filing-deposits"
import { cn } from "@/lib/utils"

type Props = {
  requirement: FilingRequirement
  chain: ChainConfig
  /** The submitting account's free balance, when known. */
  balanceFree: bigint | null
  /** The track's decision deposit; null when the track isn't known yet. */
  decisionDeposit: bigint | null
  trackLabel: string | null
  /** False when the batch only adds details to an existing referendum. */
  submits?: boolean
}

/**
 * What a filing batch reserves and the free balance it needs, from the
 * chain's constants (see filingRequirement), plus the track's decision
 * deposit, which deciding needs but anyone can place later.
 */
export function FilingCosts({
  requirement: r,
  chain,
  balanceFree,
  decisionDeposit,
  trackLabel,
  submits = true,
}: Props) {
  const short = balanceFree != null && balanceFree < r.total
  const fmt = (v: bigint) => formatTokenAmount(v, chain)
  return (
    <div className="rounded-2xl bg-card border border-border p-5 space-y-3">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Coins className="w-4 h-4 text-muted-foreground" />
        Deposits and fees
      </h2>
      <dl className="space-y-2 text-xs">
        {submits && (
          <Line label="Submission deposit" value={fmt(r.submissionDeposit)}>
            Refunded if the referendum is approved or cancelled. It stays reserved if the
            referendum is rejected or times out.
          </Line>
        )}
        {r.callPreimageDeposit > 0n && (
          <Line label="Call preimage deposit" value={fmt(r.callPreimageDeposit)} />
        )}
        <Line label="EGOV1 record preimage deposit" value={fmt(r.envelopePreimageDeposit)}>
          {r.callPreimageDeposit > 0n ? "Preimage deposits are" : "This deposit is"} priced
          per byte by the chain. Reclaim them from your account page once the referendum no
          longer needs them.
        </Line>
        <Line label="Fees and minimum balance" value={fmt(r.feesAndMinimum)}>
          The transaction fee, and the {chain.ticker} that must stay free while deposits are
          reserved.
        </Line>
        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
          <dt className="font-medium text-foreground">Needed free to sign</dt>
          <dd className={cn("font-mono", short ? "text-amber-300" : "text-foreground")}>
            {fmt(r.total)}
          </dd>
        </div>
      </dl>
      {short && balanceFree != null && (
        <p className="text-[11px] text-amber-300 leading-relaxed">
          Your free balance is {fmt(balanceFree)}.
        </p>
      )}
      {submits && (
        <p className="text-[11px] text-muted-foreground leading-relaxed rounded-lg border border-border bg-surface-1 p-2.5">
          <span className="text-foreground">Decision deposit</span>
          {trackLabel ? ` (${trackLabel} track)` : ""}
          {decisionDeposit != null && (
            <>
              : <span className="font-mono text-foreground">{fmt(decisionDeposit)}</span>
            </>
          )}
          . Not part of this batch: the referendum can start deciding only once it is placed,
          and anyone can place it. It is refunded once the referendum concludes.
        </p>
      )}
    </div>
  )
}

function Line({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="font-mono text-foreground whitespace-nowrap">{value}</dd>
      </div>
      {children && (
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{children}</p>
      )}
    </div>
  )
}

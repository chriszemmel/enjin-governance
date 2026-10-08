"use client"

import { Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPlanckShort } from "./create-ui"

export function BeneficiaryCard({
  isConnected,
  accountName,
  address,
  chainShortName,
  balanceFree,
  requiredPlanck,
  balanceSufficient,
  chainTicker,
  chainDecimals,
  onConnect,
}: {
  isConnected: boolean
  accountName: string | null
  address: string | null
  chainShortName: string
  balanceFree: bigint | null
  requiredPlanck: bigint | null
  balanceSufficient: boolean
  chainTicker: string
  chainDecimals: number
  onConnect: () => void
}) {
  if (!isConnected) {
    return (
      <div className="rounded-xl bg-amber-500/5 border border-amber-500/30 p-4 flex items-start gap-3">
        <Wallet className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            Connect a wallet to continue
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            You propose with your connected wallet. The treasury payout defaults
            to it, but you can set a different beneficiary below.
          </p>
          <button
            type="button"
            onClick={onConnect}
            className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-primary/5 border border-purple-border p-4 flex items-start gap-3">
      <Wallet className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Proposer · your connected wallet
        </p>
        {accountName && (
          <p className="text-sm font-semibold text-foreground mt-0.5">
            {accountName}
          </p>
        )}
        <p className="text-xs font-mono text-muted-foreground mt-1 break-all">
          {address ?? "-"}
        </p>
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          You file this proposal from this {chainShortName} wallet and cover its
          deposits. Set the payout beneficiary below.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
          <BalanceLine
            label="Your free balance"
            value={balanceFree}
            chainTicker={chainTicker}
            chainDecimals={chainDecimals}
            warn={!balanceSufficient}
          />
          <BalanceLine
            label="Required to propose"
            value={requiredPlanck}
            chainTicker={chainTicker}
            chainDecimals={chainDecimals}
            hint="Deposits and fees, itemised below"
          />
        </div>
        {!balanceSufficient && requiredPlanck != null && balanceFree != null && (
          <p className="mt-3 text-[11px] text-amber-300 leading-relaxed">
            Your free balance is below the required total. You need at least{" "}
            <span className="font-mono text-foreground">
              {formatPlanckShort(requiredPlanck, chainDecimals, chainTicker)}
            </span>{" "}
            free to file this proposal: the submission deposit, the preimage
            deposits, fees and the minimum balance. The track&apos;s decision
            deposit isn&apos;t included - anyone can place it later.
          </p>
        )}
      </div>
    </div>
  )
}

function BalanceLine({
  label,
  value,
  chainTicker,
  chainDecimals,
  hint,
  warn,
}: {
  label: string
  value: bigint | null
  chainTicker: string
  chainDecimals: number
  hint?: string
  warn?: boolean
}) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-mono mt-0.5",
          warn ? "text-amber-300" : "text-foreground",
        )}
      >
        {value == null ? "-" : formatPlanckShort(value, chainDecimals, chainTicker)}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  )
}

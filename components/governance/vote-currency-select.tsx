"use client"

import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import type { ChainConfig } from "@/lib/chain/chains"
import { formatTokenAmount } from "@/lib/chain/format"
import {
  sEnjCurrency,
  type VoteCurrency,
} from "@/lib/governance/conviction-voting"
import {
  DESTROYING_POOL_VOTING_ENDS_SPEC,
  senjCanVote,
  type StakedEnjHolding,
} from "@/lib/governance/staking-pools"
import { cn } from "@/lib/utils"
import { EnjAvatar } from "./enj-avatar"
import { PoolNftAvatar } from "./pool-nft-avatar"

/**
 * A vote-source toggle: liquid ENJ, or any sENJ pool the user holds a
 * non-zero balance in. Renders as a single row with the active source
 * shown inline; tapping expands a dropdown with one item per source. From
 * spec 1080 a pool being destroyed is listed but can't be picked (see
 * senjCanVote).
 *
 * Returns null callers should treat as "no holdings beyond liquid ENJ"
 * so the parent can skip rendering the selector entirely when there's
 * only one option.
 */
export type SelectedCurrency =
  | { kind: "Enj"; freeBalance: bigint | null }
  | {
      kind: "SEnj"
      poolId: number
      poolName: string | null
      /** sENJ balance (what gets submitted to the extrinsic). */
      senjBalance: bigint
      /** ENJ equivalent at current stake rate, for display. */
      realEnjBalance: bigint
    }

export function selectionToVoteCurrency(sel: SelectedCurrency): VoteCurrency {
  return sel.kind === "Enj" ? { Enj: null } : sEnjCurrency(sel.poolId)
}

type Props = {
  chain: ChainConfig
  freeEnjBalance: bigint | null
  stakedHoldings: StakedEnjHolding[]
  /** The connected runtime's spec version, which decides senjCanVote. */
  specVersion: number
  selected: SelectedCurrency
  onChange: (next: SelectedCurrency) => void
  disabled?: boolean
}

export function VoteCurrencySelect({
  chain,
  freeEnjBalance,
  stakedHoldings,
  specVersion,
  selected,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)

  const enjOption: SelectedCurrency = {
    kind: "Enj",
    freeBalance: freeEnjBalance,
  }
  const senjOptions: SelectedCurrency[] = stakedHoldings.map((h) => ({
    kind: "SEnj",
    poolId: h.poolId,
    poolName: h.poolName,
    senjBalance: h.senjBalance,
    realEnjBalance: h.realEnjBalance,
  }))

  // Only render the selector when the user has at least one sENJ
  // option - otherwise it's a no-op control wasting vertical space.
  if (senjOptions.length === 0) return null

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3.5 py-3 text-sm hover:bg-surface-1 transition-colors disabled:opacity-50"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Avatar selection={selected} />
          <span className="flex flex-col items-start min-w-0">
            <CurrencyLabel selection={selected} />
            <BalanceLabel selection={selected} chain={chain} />
          </span>
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground flex-shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border max-h-64 overflow-y-auto">
          <OptionRow
            option={enjOption}
            chain={chain}
            active={selected.kind === "Enj"}
            onPick={() => {
              onChange(enjOption)
              setOpen(false)
            }}
          />
          {senjOptions.map((opt, i) => (
            <OptionRow
              key={opt.kind === "SEnj" ? opt.poolId : "enj"}
              option={opt}
              chain={chain}
              active={
                selected.kind === "SEnj" &&
                opt.kind === "SEnj" &&
                selected.poolId === opt.poolId
              }
              blockedNote={
                senjCanVote(stakedHoldings[i]!.poolState, specVersion)
                  ? null
                  : `This pool is being destroyed. Since runtime ${DESTROYING_POOL_VOTING_ENDS_SPEC} its sENJ can't vote or delegate.`
              }
              onPick={() => {
                onChange(opt)
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function OptionRow({
  option,
  chain,
  active,
  blockedNote = null,
  onPick,
}: {
  option: SelectedCurrency
  chain: ChainConfig
  active: boolean
  /** Why this source can't vote; the row is then disabled. */
  blockedNote?: string | null
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={blockedNote != null}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs transition-colors disabled:cursor-not-allowed",
        active ? "bg-primary/10" : blockedNote ? "" : "hover:bg-surface-1",
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={cn("flex-shrink-0", blockedNote && "opacity-50")}>
          <Avatar selection={option} size="sm" />
        </span>
        <span className="flex flex-col items-start min-w-0">
          <span className={cn("flex flex-col items-start min-w-0", blockedNote && "opacity-50")}>
            <CurrencyLabel selection={option} />
            <BalanceLabel selection={option} chain={chain} />
          </span>
          {blockedNote && (
            <span className="text-[10px] text-amber-300 text-left leading-snug mt-0.5">
              {blockedNote}
            </span>
          )}
        </span>
      </span>
      {active && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
    </button>
  )
}

function Avatar({
  selection,
  size = "md",
}: {
  selection: SelectedCurrency
  size?: "sm" | "md"
}) {
  if (selection.kind === "Enj") return <EnjAvatar size={size} />
  return <PoolNftAvatar poolId={selection.poolId} size={size} />
}

function CurrencyLabel({ selection }: { selection: SelectedCurrency }) {
  if (selection.kind === "Enj") {
    return <span className="text-foreground text-sm font-medium">ENJ</span>
  }
  // Pool name fallback chain: explicit on-chain name → "Pool #id".
  const label = selection.poolName ?? `Pool #${selection.poolId}`
  return (
    <span className="text-foreground text-sm font-medium truncate">
      sENJ · {label}
    </span>
  )
}

function BalanceLabel({
  selection,
  chain,
}: {
  selection: SelectedCurrency
  chain: ChainConfig
}) {
  if (selection.kind === "Enj") {
    if (selection.freeBalance == null) {
      return (
        <span className="text-[10px] text-muted-foreground font-mono">…</span>
      )
    }
    return (
      <span className="text-[10px] text-muted-foreground font-mono">
        {formatTokenAmount(selection.freeBalance, chain, {
          maxFractionDigits: 2,
        })}{" "}
        available
      </span>
    )
  }
  return (
    <span className="text-[10px] text-muted-foreground font-mono">
      {formatTokenAmount(selection.senjBalance, chain, {
        maxFractionDigits: 2,
        withTicker: false,
      })}{" "}
      sENJ · ≈{" "}
      {formatTokenAmount(selection.realEnjBalance, chain, {
        maxFractionDigits: 2,
      })}
    </span>
  )
}

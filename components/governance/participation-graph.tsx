"use client"

import { useMemo } from "react"
import { Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChainConfig } from "@/lib/chain/chains"
import { formatTokenAmountCompact } from "@/lib/chain/format"
import { CONVICTION_MULTIPLIER, type Conviction } from "@/lib/governance/types"
import { decodeVote, decodeCurrency } from "@/lib/governance/vote-decode"
import {
  type ReferendumVote,
  useReferendumVotes,
} from "@/lib/query/hooks/use-referendum-votes"
import { Bar } from "./skeletons"

interface ParticipationGraphProps {
  referendumIndex: number
  chain: ChainConfig
}

const CONVICTION_ORDER: readonly Conviction[] = [
  "None",
  "Locked1x",
  "Locked2x",
  "Locked3x",
  "Locked4x",
  "Locked5x",
  "Locked6x",
] as const

/**
 * Participation breakdown for a referendum, built entirely from the
 * chain-sourced voter list (no timestamps required - `votingFor.entries()`
 * doesn't carry them). Two views:
 *
 *   1. A stacked horizontal bar split aye (green, left) vs nay (red, right).
 *      Each voter is one segment, width proportional to their
 *      conviction-weighted power. Big voters become large segments;
 *      many small voters become a fine pattern of slivers. Gives a
 *      "one whale or many holders" read at a glance.
 *
 *   2. A conviction histogram showing how voting power was distributed
 *      across the six conviction tiers (None, 1x … 6x). Higher
 *      conviction = more skin in the game (longer post-vote lock).
 *
 * Surfaces only when we have rows to graph; the upstream <VotesList>
 * already renders an empty state otherwise.
 */
export function ParticipationGraph({
  referendumIndex,
  chain,
}: ParticipationGraphProps) {
  const query = useReferendumVotes(referendumIndex)
  const summary = useMemo(() => summarise(query.data ?? []), [query.data])
  const rows = query.data ?? []

  if (query.isPending) {
    return (
      <div className="space-y-3 animate-pulse">
        <Bar className="h-3 w-full rounded-full" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Bar key={i} className="h-12 rounded-md" />
          ))}
        </div>
      </div>
    )
  }

  if (rows.length === 0) return null

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Users className="w-3 h-3" />
          Voter distribution
        </p>
        <p className="text-[10px] text-muted-foreground">
          {summary.totalVoters} voter{summary.totalVoters === 1 ? "" : "s"}
        </p>
      </header>

      <DistributionBar summary={summary} chain={chain} />

      <ConvictionHistogram summary={summary} />
    </div>
  )
}

// Bar that shows each voter as a segment proportional to their power
function DistributionBar({
  summary,
  chain,
}: {
  summary: Summary
  chain: ChainConfig
}) {
  const ayePower = summary.ayeTotal
  const nayPower = summary.nayTotal
  const totalPower = ayePower + nayPower
  if (totalPower === 0n) return null

  const ayeFrac = Number((ayePower * 10000n) / totalPower) / 100
  const nayFrac = 100 - ayeFrac

  return (
    <div className="space-y-1.5">
      <div className="flex items-stretch w-full h-3 rounded-full overflow-hidden bg-surface-3">
        {/* Aye side, growing right-to-left from the boundary */}
        <div className="flex" style={{ width: `${ayeFrac}%` }}>
          {summary.aye.map((v, i) => (
            <VoterSegment
              key={`aye-${v.voter}-${i}`}
              widthPct={
                ayePower > 0n
                  ? (Number((v.power * 10000n) / ayePower) / 100) * (ayeFrac / 100) * 100
                  : 0
              }
              tone="aye"
              power={v.power}
              chain={chain}
              voter={v.voter}
            />
          ))}
        </div>
        {/* Nay side */}
        <div className="flex" style={{ width: `${nayFrac}%` }}>
          {summary.nay.map((v, i) => (
            <VoterSegment
              key={`nay-${v.voter}-${i}`}
              widthPct={
                nayPower > 0n
                  ? (Number((v.power * 10000n) / nayPower) / 100) * (nayFrac / 100) * 100
                  : 0
              }
              tone="nay"
              power={v.power}
              chain={chain}
              voter={v.voter}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {summary.aye.length} aye · {formatTokenAmountCompact(summary.ayeTotal, chain)}
        </span>
        <span>
          {formatTokenAmountCompact(summary.nayTotal, chain)} ·{" "}
          {summary.nay.length} nay
        </span>
      </div>
      {summary.senjTotal > 0n && (
        <p className="text-[10px] text-muted-foreground/80 leading-snug">
          Includes {formatTokenAmountCompact(summary.senjTotal, chain, { withTicker: false })} sENJ
          across {summary.senjPoolCount} pool{summary.senjPoolCount === 1 ? "" : "s"}
          {" "}({formatTokenAmountCompact(summary.enjTotal, chain, { withTicker: false })} ENJ liquid)
        </p>
      )}
    </div>
  )
}

function VoterSegment({
  widthPct,
  tone,
  power,
  chain,
  voter,
}: {
  widthPct: number
  tone: "aye" | "nay"
  power: bigint
  chain: ChainConfig
  voter: string
}) {
  if (widthPct <= 0) return null
  return (
    <div
      className={cn(
        "h-full",
        tone === "aye" ? "bg-green-500" : "bg-red-500",
        // Slight inner border to separate adjacent segments without
        // changing the perceived tally split.
        "shadow-[inset_-1px_0_0_rgba(0,0,0,0.25)]",
      )}
      style={{ width: `${widthPct}%` }}
      title={`${voter}\n${formatTokenAmountCompact(power, chain)} (${tone})`}
    />
  )
}

function ConvictionHistogram({ summary }: { summary: Summary }) {
  const maxPower = summary.convictionMax
  if (maxPower === 0n) return null
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
        Conviction distribution
      </p>
      <div className="grid grid-cols-7 gap-2">
        {CONVICTION_ORDER.map((c) => {
          const bucket = summary.byConviction[c]
          const height =
            maxPower > 0n ? Number((bucket.power * 1000n) / maxPower) / 10 : 0
          const label =
            c === "None"
              ? "0.1x"
              : `${CONVICTION_MULTIPLIER[c]}x`
          return (
            <div key={c} className="flex flex-col items-center gap-1">
              <div className="flex items-end h-12 w-full rounded-md bg-surface-2 overflow-hidden">
                <div
                  className="w-full bg-primary/80 transition-all"
                  style={{ height: `${Math.max(2, height)}%` }}
                  title={`${bucket.count} vote${bucket.count === 1 ? "" : "s"}`}
                />
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Summarise the chain rows once, share with both visualisations
type VoterSlice = { voter: string; power: bigint; aye: boolean }

type Summary = {
  totalVoters: number
  aye: VoterSlice[]
  nay: VoterSlice[]
  ayeTotal: bigint
  nayTotal: bigint
  byConviction: Record<Conviction, { count: number; power: bigint }>
  convictionMax: bigint
  /** Sum of raw balances cast as liquid ENJ (no conviction weighting). */
  enjTotal: bigint
  /** Sum of raw balances cast as staked-pool sENJ (no conviction weighting). */
  senjTotal: bigint
  /** Distinct pool ids that contributed sENJ votes. */
  senjPoolCount: number
}

function summarise(rows: readonly ReferendumVote[]): Summary {
  const emptyBucket = () => ({ count: 0, power: 0n })
  const byConviction: Record<Conviction, { count: number; power: bigint }> = {
    None: emptyBucket(),
    Locked1x: emptyBucket(),
    Locked2x: emptyBucket(),
    Locked3x: emptyBucket(),
    Locked4x: emptyBucket(),
    Locked5x: emptyBucket(),
    Locked6x: emptyBucket(),
  }

  const aye: VoterSlice[] = []
  const nay: VoterSlice[] = []
  let ayeTotal = 0n
  let nayTotal = 0n
  let enjTotal = 0n
  let senjTotal = 0n
  const senjPools = new Set<number>()

  for (const row of rows) {
    const decoded = decodeVote(row.voteRaw)
    if (!decoded) continue
    const conviction = decoded.conviction
    // Conviction-weighted voting power. None counts as 0.1x; multiplier
    // values are floats so scale balance into a fixed-point bigint to
    // keep precision.
    const power = scaleByMultiplier(row.balance, CONVICTION_MULTIPLIER[conviction])
    const slice: VoterSlice = { voter: row.voter, power, aye: decoded.aye }
    if (decoded.aye) {
      aye.push(slice)
      ayeTotal += power
    } else {
      nay.push(slice)
      nayTotal += power
    }
    const bucket = byConviction[conviction]
    bucket.count += 1
    bucket.power += power

    // Track raw (unweighted) balances per currency so the header can
    // surface "X ENJ + Y sENJ across N pools" - chain tally already
    // counts both at 1:1, but breaking it out makes it clear that
    // staked-pool holders are participating.
    const currency = decodeCurrency(row.currencyRaw)
    if (currency.kind === "SEnj") {
      senjTotal += row.balance
      senjPools.add(currency.poolId)
    } else {
      enjTotal += row.balance
    }
  }

  aye.sort((a, b) => (b.power > a.power ? 1 : b.power < a.power ? -1 : 0))
  nay.sort((a, b) => (b.power > a.power ? 1 : b.power < a.power ? -1 : 0))

  const convictionMax = (Object.values(byConviction) as { power: bigint }[])
    .map((b) => b.power)
    .reduce((m, x) => (x > m ? x : m), 0n)

  return {
    totalVoters: rows.length,
    aye,
    nay,
    ayeTotal,
    nayTotal,
    byConviction,
    convictionMax,
    enjTotal,
    senjTotal,
    senjPoolCount: senjPools.size,
  }
}

/**
 * Multiply a bigint by a float multiplier without losing precision.
 * Used for conviction-weighting (multipliers are 0.1, 1, 2, …, 6).
 */
function scaleByMultiplier(value: bigint, multiplier: number): bigint {
  // Scale to 4 decimal places of multiplier precision.
  const scaled = BigInt(Math.round(multiplier * 10_000))
  return (value * scaled) / 10_000n
}

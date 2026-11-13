"use client"

import { useMemo } from "react"
import { CHAINS } from "@/lib/chain/chains"
import { blocksToSeconds, formatTokenAmount } from "@/lib/chain/format"
import { formatTrackName } from "@/lib/governance/display"
import type { Track } from "@/lib/governance/types"
import { perbillParts, thresholdParts } from "@/lib/governance/verdict"
import { durationWords } from "@/lib/governance/verdict-copy"
import { useSupportIssuance } from "@/lib/query/hooks/use-support-issuance"
import { useTracks } from "@/lib/query/hooks/use-tracks"

const CHAIN = CHAINS["enjin-relay"]
const ENJ = 10n ** 18n
const PERBILL = 1_000_000_000n
const LISTED = [
  "small_tipper",
  "big_tipper",
  "small_spender",
  "medium_spender",
  "big_spender",
  "whitelisted_caller",
  "referendum_canceller",
  "referendum_killer",
  "root",
]
const SPENDERS = ["small_spender", "medium_spender", "big_spender"]
const EXAMPLE_AMOUNTS = [
  500_000n,
  1_000_000n,
  2_500_000n,
  5_000_000n,
  10_000_000n,
  25_000_000n,
  50_000_000n,
  100_000_000n,
]

/**
 * Live tables for the docs: each track's minimum support at the end of its
 * decision period, and how long a referendum takes to pass with a given
 * amount of support. Read from Enjin Relay, with the runtime's own
 * fixed-point curves (lib/governance/verdict.ts).
 */
export function SupportRequirements() {
  const tracksQuery = useTracks(CHAIN)
  const issuanceQuery = useSupportIssuance(CHAIN)
  const tracks = tracksQuery.data
  const issuance = issuanceQuery.data

  const model = useMemo(() => {
    if (!tracks || !issuance) return null
    const byName = new Map(tracks.map((t) => [t.name, t]))
    const floorOf = (t: Track) => thresholdParts(t.minSupport, PERBILL)
    const planck = (parts: bigint) => (parts * issuance.denominator + PERBILL - 1n) / PERBILL

    const rows: Array<{ label: string; track: Track }> = LISTED.flatMap((n) => {
      const t = byName.get(n)
      return t ? [{ label: formatTrackName(t.name), track: t }] : []
    })
    // Every other track: one row when they all share the same numbers.
    const rest = tracks.filter((t) => !LISTED.includes(t.name))
    const same = rest.every(
      (t) =>
        floorOf(t) === floorOf(rest[0]!) &&
        t.decisionPeriod === rest[0]!.decisionPeriod &&
        t.confirmPeriod === rest[0]!.confirmPeriod,
    )
    if (rest.length > 0 && same)
      rows.push({ label: `Other admin tracks (${rest.length})`, track: rest[0]! })
    else rest.forEach((t) => rows.push({ label: formatTrackName(t.name), track: t }))

    const daysToPass = (t: Track, amount: bigint): number | null => {
      const support = perbillParts(amount * ENJ, issuance.denominator)
      if (support < floorOf(t)) return null
      // First block of the decision period where the support curve is met
      // (100% aye meets the approval curve from the start).
      let lo = 0
      let hi = t.decisionPeriod
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        const x = perbillParts(BigInt(mid), BigInt(t.decisionPeriod))
        if (support >= thresholdParts(t.minSupport, x)) hi = mid
        else lo = mid + 1
      }
      return blocksToSeconds(t.preparePeriod + lo + t.confirmPeriod) / 86_400
    }

    return {
      rows: rows.map(({ label, track }) => ({
        label,
        pct: Number(floorOf(track)) / 1e7,
        amount: formatTokenAmount(planck(floorOf(track)), CHAIN, { maxFractionDigits: 0 }),
        decision: durationWords(track.decisionPeriod),
        confirm: durationWords(track.confirmPeriod),
      })),
      spenders: SPENDERS.flatMap((n) => {
        const t = byName.get(n)
        return t ? [{ label: formatTrackName(t.name), track: t }] : []
      }),
      daysToPass,
      issuance: formatTokenAmount(issuance.denominator, CHAIN, { maxFractionDigits: 0 }),
      basis: issuance.basis,
      medium: byName.get("medium_spender") ?? null,
      mediumFloor: byName.get("medium_spender")
        ? formatTokenAmount(planck(floorOf(byName.get("medium_spender")!)), CHAIN, {
            maxFractionDigits: 0,
          })
        : null,
    }
  }, [tracks, issuance])

  if (!model) {
    return (
      <p className="text-sm text-muted-foreground">
        {tracksQuery.isError || issuanceQuery.isError
          ? "Couldn't load the live values from Enjin Relay."
          : "Loading the live values from Enjin Relay…"}
      </p>
    )
  }

  const fmtDays = (d: number | null) => (d == null ? "-" : `${d.toFixed(1)} days`)
  const short = (a: bigint) => (a >= 1_000_000n ? `${Number(a) / 1e6}M` : `${Number(a) / 1e3}k`)

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-foreground pt-2">Minimum support at the end</h3>
      <p>
        The lowest the support requirement goes. With less support a referendum can&apos;t pass on
        that track, whatever its approval.
      </p>
      <table className="text-sm w-full">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="font-medium pr-3 pb-1 align-top">Track</th>
            <th className="font-medium pr-3 pb-1 text-right align-top">Minimum</th>
            <th className="font-medium pb-1 text-right">
              <span className="block">Decision</span>
              <span className="block text-xs font-normal">Confirm</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r) => (
            <tr key={r.label} className="border-t border-border align-top">
              <td className="pr-3 py-1.5">{r.label}</td>
              <td className="pr-3 py-1.5 text-right tabular-nums">
                <span className="block whitespace-nowrap">{r.amount}</span>
                <span className="block text-xs text-muted-foreground">
                  {Number(r.pct.toPrecision(3))}%
                </span>
              </td>
              <td className="py-1.5 text-right">
                <span className="block whitespace-nowrap">{r.decision}</span>
                <span className="block text-xs text-muted-foreground whitespace-nowrap">
                  {r.confirm}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        Live from Enjin Relay, as a share of {model.basis} issuance ({model.issuance} right now).
        Issuance grows over time, so the amounts grow with it.
      </p>

      <h3 className="text-base font-semibold text-foreground pt-2">More support passes faster</h3>
      <p>
        With a lot of support a referendum meets the falling requirement early and passes long
        before its decision period ends. Time from submission until it passes, with 100% aye and the
        decision deposit placed right away:
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="font-medium pr-3 pb-1">Support</th>
              {model.spenders.map((s) => (
                <th key={s.label} className="font-medium pr-3 pb-1 text-right last:pr-0">
                  {s.label.replace(" Spender", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EXAMPLE_AMOUNTS.map((a) => (
              <tr key={a.toString()} className="border-t border-border">
                <td className="pr-3 py-1.5 tabular-nums whitespace-nowrap">{short(a)} ENJ</td>
                {model.spenders.map((s) => {
                  const d = model.daysToPass(s.track, a)
                  return (
                    <td
                      key={s.label}
                      className={`pr-3 py-1.5 text-right tabular-nums whitespace-nowrap last:pr-0 ${d == null ? "text-muted-foreground" : ""}`}
                    >
                      {fmtDays(d)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Small, Medium and Big Spender tracks. Includes the prepare and confirm periods; a spend is
        paid out after its enactment delay. A dash means the support is below the track&apos;s
        minimum, so it can&apos;t pass.
      </p>
      {model.medium && model.mediumFloor && (
        <p>
          <strong>Example:</strong> a request for 200,000 ENJ runs on Medium Spender. It needs at
          least {model.mediumFloor} of support. With 2.5M ENJ of aye votes it passes after about{" "}
          {fmtDays(model.daysToPass(model.medium, 2_500_000n))}, with 25M ENJ after about{" "}
          {fmtDays(model.daysToPass(model.medium, 25_000_000n))}.
        </p>
      )}
    </div>
  )
}

"use client"

import Link from "next/link"
import { AlertTriangle, Check, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatBlockDuration, formatTokenAmount } from "@/lib/chain/format"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { canonicalTrackName } from "@/lib/governance/tracks"
import type { ReferendaPallet } from "@/lib/governance/referenda"
import type { ReferendumStatusType, Track } from "@/lib/governance/types"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useWhitelistLink } from "@/lib/query/hooks/use-whitelist"

type StepState = "done" | "active" | "todo"

const short = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-4)}`

/**
 * The fast track through the Fellowship, on both of its pages: the
 * fellowship referendum that whitelists a call by hash, and the public
 * WhitelistedCaller referendum that dispatches it. Four steps, where the
 * call stands, and both tracks' terms read from the runtime. Renders
 * nothing for any other call.
 */
export function FastTrackCard({
  bytes,
  pallet,
  status,
}: {
  bytes: Uint8Array | null | undefined
  pallet: ReferendaPallet
  status: ReferendumStatusType
}) {
  const chain = useActiveChain()
  const { role, whitelisted, counterparts } = useWhitelistLink(bytes)
  const tracks = useTracks().data ?? []
  if (!role) return null

  const others = counterparts.data ?? []
  const fellowship =
    pallet === "fellowshipReferenda" ? { status } : others.find((c) => c.status === "Approved") ?? others[0]
  const publicRef = pallet === "referenda" ? { status } : others[0]
  const isWhitelisted = whitelisted.data === true
  const dispatched = publicRef?.status === "Approved" && !isWhitelisted

  const steps: { label: string; sub: string; state: StepState }[] = [
    {
      label: "Fellowship vote",
      sub: fellowship ? (fellowship.status === "Ongoing" ? "Voting" : fellowship.status) : "Not filed yet",
      state: !fellowship ? "todo" : fellowship.status === "Approved" ? "done" : fellowship.status === "Ongoing" ? "active" : "todo",
    },
    {
      label: "Call whitelisted",
      sub: "whitelist.CallWhitelisted",
      state: isWhitelisted || dispatched ? "done" : fellowship?.status === "Approved" ? "active" : "todo",
    },
    {
      label: "Public vote",
      sub: "WhitelistedCaller",
      state: !publicRef ? "todo" : publicRef.status === "Approved" ? "done" : publicRef.status === "Ongoing" ? "active" : "todo",
    },
    {
      label: "Dispatch",
      sub: "runs as Root",
      state: dispatched ? "done" : "todo",
    },
  ]

  const wc = tracks.find((t) => canonicalTrackName(t.name) === "whitelistedcaller") ?? null
  const root = tracks.find((t) => t.id === 0) ?? null
  const otherLink = others[0]

  return (
    <section className="rounded-2xl bg-card border border-purple-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            {role.role === "whitelist" ? "Whitelist a call" : "Fast track via the Fellowship"}
          </p>
          <p className="font-semibold text-foreground mt-1">
            Call <span className="font-mono">{short(role.hash)}</span>{" "}
            {isWhitelisted ? "is whitelisted" : dispatched ? "was dispatched" : "is not whitelisted yet"}
          </p>
        </div>
        {otherLink && (
          <Link
            href={
              otherLink.pallet === "fellowshipReferenda"
                ? `/fellowship/${otherLink.index}?network=${chain.id}`
                : `/proposals/${otherLink.index}?network=${chain.id}`
            }
            className="text-xs text-primary hover:text-primary/80 whitespace-nowrap"
          >
            {otherLink.pallet === "fellowshipReferenda" ? `Open F#${otherLink.index}` : `Public referendum #${otherLink.index}`} →
          </Link>
        )}
      </div>

      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={cn(
              "rounded-xl border px-3 py-2.5",
              s.state === "active" ? "border-purple-border bg-primary/5" : "border-border",
            )}
          >
            <span
              className={cn(
                "inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-semibold mb-1.5",
                s.state === "done"
                  ? "bg-primary text-primary-foreground"
                  : s.state === "active"
                    ? "border border-primary text-primary"
                    : "border border-border text-muted-foreground",
              )}
            >
              {s.state === "done" ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <p className="text-xs font-medium text-foreground">{s.label}</p>
            <p className="text-[10px] text-muted-foreground font-mono truncate">{s.sub}</p>
          </li>
        ))}
      </ol>

      {(wc || root) && (
        <div className="grid sm:grid-cols-2 gap-2">
          {wc && <Terms title="Whitelisted Caller" track={wc} chain={chain} highlight />}
          {root && <Terms title="The same call on Root" track={root} chain={chain} />}
        </div>
      )}

      {role.role === "dispatch" && !isWhitelisted && !dispatched && whitelisted.isSuccess && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Until the Fellowship whitelists this call, enactment would fail with
          CallIsNotWhitelisted.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        The Fellowship vouches for these exact bytes; the public vote decides whether they run.
        Full hash: <span className="font-mono break-all">{role.hash}</span>
      </p>
    </section>
  )

}

function Terms({
  title,
  track,
  chain,
  highlight,
}: {
  title: string
  track: Track
  chain: ChainConfig
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        highlight ? "border-green-500/30 bg-green-500/5" : "border-border",
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="text-xs text-foreground mt-1">
        Confirm {formatBlockDuration(track.confirmPeriod)} · decide{" "}
        {formatBlockDuration(track.decisionPeriod)}
      </p>
      <p className="text-[11px] text-muted-foreground font-mono">
        {formatTokenAmount(track.decisionDeposit, chain, { maxFractionDigits: 0 })} decision deposit
      </p>
    </div>
  )
}

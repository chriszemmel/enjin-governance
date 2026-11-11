"use client"

import Link from "next/link"
import { AlertTriangle, ArrowRight, Check, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChainConfig } from "@/lib/chain/chains"
import { formatBlockDuration, formatTokenAmount } from "@/lib/chain/format"
import { useActiveChain } from "@/lib/chain/use-chain"
import { canonicalTrackName } from "@/lib/governance/tracks"
import type { ReferendumStatusType, Track } from "@/lib/governance/types"
import { usePreimage } from "@/lib/query/hooks/use-preimage"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useWhitelistLink } from "@/lib/query/hooks/use-whitelist"

type StepState = "done" | "active" | "todo"

const shortHash = (hash: string) => `${hash.slice(0, 6)}…${hash.slice(-4)}`
const midHash = (hash: string) => `${hash.slice(0, 32)}…${hash.slice(-24)}`

/** "Whitelisted by the Fellowship", in a public referendum's header. */
export function WhitelistedChip({ bytes }: { bytes: Uint8Array | null | undefined }) {
  const { role, whitelisted } = useWhitelistLink(bytes)
  if (role?.role !== "dispatch" || whitelisted.data !== true) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400">
      <ShieldCheck className="w-3.5 h-3.5" />
      Whitelisted by the Fellowship
    </span>
  )
}

/**
 * A public WhitelistedCaller referendum's fast track: the call's hash and
 * whether the Fellowship whitelisted it, where it stands from the
 * fellowship vote to dispatch, and both tracks' terms, read from the
 * runtime. Renders nothing for any other call.
 */
export function FastTrackCard({
  bytes,
  status,
}: {
  bytes: Uint8Array | null | undefined
  status: ReferendumStatusType
}) {
  const chain = useActiveChain()
  const { role, whitelisted, counterparts } = useWhitelistLink(bytes)
  const tracks = useTracks().data ?? []
  if (role?.role !== "dispatch") return null

  const others = counterparts.data ?? []
  const fellowship = others.find((c) => c.status === "Approved") ?? others[0] ?? null
  const isWhitelisted = whitelisted.data === true
  const dispatched = status === "Approved" && !isWhitelisted

  const steps: { label: string; sub: string; state: StepState }[] = [
    {
      label: "Fellowship vote",
      sub: fellowship
        ? `F#${fellowship.index} ${fellowship.status === "Ongoing" ? "voting" : fellowship.status.toLowerCase()}`
        : isWhitelisted || dispatched
          ? "approved"
          : "Not filed yet",
      state:
        isWhitelisted || dispatched || fellowship?.status === "Approved"
          ? "done"
          : fellowship?.status === "Ongoing"
            ? "active"
            : "todo",
    },
    {
      label: "Call whitelisted",
      sub: "CallWhitelisted",
      state: isWhitelisted || dispatched ? "done" : "todo",
    },
    {
      label: "Public vote",
      sub: "WhitelistedCaller",
      state: status === "Approved" ? "done" : status === "Ongoing" ? "active" : "todo",
    },
    { label: "Dispatch", sub: "runs as Root", state: dispatched ? "done" : "todo" },
  ]

  const wc = tracks.find((t) => canonicalTrackName(t.name) === "whitelistedcaller") ?? null
  const root = tracks.find((t) => t.id === 0) ?? null

  return (
    <section className="rounded-2xl bg-card border border-border p-6 space-y-5 bg-gradient-to-b from-primary/5 to-transparent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Fast track via the Fellowship
          </p>
          <p className="text-lg font-semibold text-foreground mt-1">
            Call <span className="font-mono">{shortHash(role.hash)}</span>{" "}
            {isWhitelisted
              ? "is whitelisted"
              : dispatched
                ? "was dispatched"
                : "is not whitelisted yet"}
          </p>
        </div>
        {fellowship && (
          <Link
            href={`/fellowship/${fellowship.index}?network=${chain.id}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 whitespace-nowrap mt-5"
          >
            Open F#{fellowship.index} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-y-4">
        {steps.map((s, i) => (
          <li key={s.label} className="min-w-0 pr-3">
            <div className="flex items-center">
              <span
                className={cn(
                  "inline-flex w-7 h-7 flex-shrink-0 rounded-full items-center justify-center text-xs font-semibold",
                  s.state === "done"
                    ? "bg-primary text-primary-foreground"
                    : s.state === "active"
                      ? "border border-primary text-primary"
                      : "border border-border text-muted-foreground",
                )}
              >
                {s.state === "done" ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </span>
              {i < steps.length - 1 && (
                <span
                  className={cn(
                    "hidden sm:block h-px flex-1 ml-3",
                    s.state === "done" ? "bg-primary/60" : "bg-border",
                  )}
                />
              )}
            </div>
            <p
              className={cn(
                "text-sm mt-2",
                s.state === "todo" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {s.label}
            </p>
            <p className="text-[11px] text-muted-foreground font-mono truncate">{s.sub}</p>
          </li>
        ))}
      </ol>

      {(wc || root) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {wc && (
            <Terms title="This track · Whitelisted Caller" track={wc} chain={chain} highlight />
          )}
          {root && <Terms title="The same call on Root" track={root} chain={chain} />}
        </div>
      )}

      {!isWhitelisted && !dispatched && whitelisted.isSuccess && (
        <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Until the call is whitelisted, enactment would fail with CallIsNotWhitelisted.
        </p>
      )}
    </section>
  )
}

/**
 * A fellowship referendum that whitelists a call: the call, its hash,
 * what it whitelists (decoded when its preimage is on chain) and the
 * public referendum it unlocks.
 */
export function WhitelistCallCard({
  bytes,
  callName,
}: {
  bytes: Uint8Array | null | undefined
  callName: string | null
}) {
  const chain = useActiveChain()
  const { role, counterparts } = useWhitelistLink(bytes)
  const inner = usePreimage(role?.role === "whitelist" ? { hash: role.hash, len: 0 } : null)
  if (role?.role !== "whitelist") return null
  const decoded = inner.data?.bytes ? inner.data : null
  const publicRef = counterparts.data?.find((c) => c.pallet === "referenda") ?? null

  return (
    <section className="rounded-2xl bg-card border border-border p-6 flex gap-4 bg-gradient-to-b from-primary/5 to-transparent">
      <span className="w-10 h-10 rounded-xl border border-purple-border bg-primary/10 flex items-center justify-center flex-shrink-0">
        <ShieldCheck className="w-5 h-5 text-primary" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Whitelist a call
          </p>
          <p className="font-mono text-lg font-semibold text-foreground mt-0.5 break-all">
            {callName ?? "whitelist.whitelistCall"}
          </p>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-[6.5rem_1fr] gap-x-4 gap-y-0.5 sm:gap-y-2 text-xs [&>dd]:mb-2 sm:[&>dd]:mb-0">
          <dt className="text-muted-foreground">Call hash</dt>
          <dd className="font-mono text-foreground break-all" title={role.hash}>
            <span className="hidden sm:inline">{midHash(role.hash)}</span>
            <span className="sm:hidden">{shortHash(role.hash)}</span>
          </dd>
          <dt className="text-muted-foreground">Whitelists</dt>
          <dd className="flex items-center gap-2 flex-wrap min-w-0">
            {decoded ? (
              <>
                <span className="font-mono text-foreground break-all">
                  {decoded.section}.{decoded.method}({argsSummary(decoded.args)})
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400">
                  preimage found
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                A call with this hash (its preimage isn&apos;t on chain)
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">Public vote</dt>
          <dd>
            {publicRef ? (
              <Link
                href={`/proposals/${publicRef.index}?network=${chain.id}`}
                className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
              >
                Referendum #{publicRef.index} · Whitelisted Caller{" "}
                <ArrowRight className="w-3 h-3" />
              </Link>
            ) : (
              <span className="text-muted-foreground">Not filed yet</span>
            )}
          </dd>
        </dl>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          If approved, the call hash is whitelisted. The public referendum can then dispatch exactly
          this call on the WhitelistedCaller track.
        </p>
      </div>
    </section>
  )
}

/** Short arguments for a one-line call: "0x4fb8…5045", numbers as they are. */
function argsSummary(args: Record<string, unknown>): string {
  return Object.values(args)
    .map((v) => {
      const s = typeof v === "string" ? v : JSON.stringify(v)
      return /^0x[0-9a-f]{16,}$/i.test(s)
        ? `${s.slice(0, 6)}…${s.slice(-4)}`
        : s.length > 24
          ? `${s.slice(0, 21)}…`
          : s
    })
    .join(", ")
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
        "rounded-xl border px-4 py-3",
        highlight ? "border-green-500/30 bg-green-500/5" : "border-border",
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="text-sm text-foreground mt-1">
        Confirm {formatBlockDuration(track.confirmPeriod)} · decide{" "}
        {formatBlockDuration(track.decisionPeriod)}
      </p>
      <p className="text-xs text-muted-foreground font-mono mt-0.5">
        {formatTokenAmount(track.decisionDeposit, chain, { maxFractionDigits: 0 })} decision deposit
      </p>
    </div>
  )
}

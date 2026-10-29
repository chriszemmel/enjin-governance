"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Lock, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import type { Call } from "@polkadot/types/interfaces"
import { isHex, u8aToHex } from "@polkadot/util"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { RankBadge } from "@/components/fellowship/rank-badge"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { formatBlockDuration, formatTokenAmount } from "@/lib/chain/format"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  buildFellowshipSubmit,
  extractFellowshipIndex,
  FELLOWSHIP_ORIGINS,
  fellowshipTrackLabel,
  MIN_SUBMIT_RANK,
  rankNumeral,
} from "@/lib/governance/fellowship"
import { callHash } from "@/lib/governance/whitelist"
import { useApi } from "@/lib/query/hooks/use-api"
import { useFellowshipTracks, useMyRank } from "@/lib/query/hooks/use-fellowship"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { useWallet } from "@/lib/wallet/use-wallet"
import { cn } from "@/lib/utils"

type Kind = "whitelist" | "raw"

type Parsed =
  | { ok: true; bytes: Uint8Array; summary: string; hash?: `0x${string}` }
  | { ok: false; error: string | null }

const INPUT =
  "w-full px-3.5 py-2.5 rounded-xl bg-surface-1 border border-border text-sm text-foreground font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"

/**
 * File a fellowship referendum: pick the track (its origin), then either
 * whitelist a call for the public fast track (by its call data or hash) or
 * enact a raw call with the Fellowship's origin. The decision deposit is
 * placed afterwards on the F# page, by anyone.
 */
export default function NewFellowshipReferendumPage() {
  const chain = useActiveChain()
  const router = useRouter()
  const queryClient = useQueryClient()
  const api = useApi().data
  const { status, activeAddress, session } = useWallet()
  const walletMeta = walletDisplayFor(session ?? null)
  const connected = status === "connected" && !!activeAddress
  const { rank } = useMyRank(activeAddress)
  const tracks = useFellowshipTracks().data ?? []
  const sign = useSignFlow()
  const [walletOpen, setWalletOpen] = useState(false)
  const [trackId, setTrackId] = useState(3)
  const [kind, setKind] = useState<Kind>("whitelist")
  const [input, setInput] = useState("")
  const track = tracks.find((t) => t.id === trackId) ?? null
  const [enactInput, setEnactInput] = useState("")
  const enactAfter = Number(enactInput || track?.minEnactmentPeriod || 10)
  const origin = FELLOWSHIP_ORIGINS.find((o) => o.trackId === trackId)!.origin
  const mayFile = rank != null && rank >= MIN_SUBMIT_RANK

  const parsed: Parsed = useMemo(() => {
    const text = input.trim()
    if (!api || !text) return { ok: false, error: null }
    if (!isHex(text)) return { ok: false, error: "Paste hex, starting with 0x." }
    if (kind === "whitelist" && text.length === 66) {
      const hash = text.toLowerCase() as `0x${string}`
      const call = api.tx.whitelist!.whitelistCall!(hash).method
      return { ok: true, bytes: call.toU8a(), summary: "whitelist.whitelistCall", hash }
    }
    let inner: Call
    try {
      inner = api.createType("Call", text) as unknown as Call
    } catch {
      return { ok: false, error: "These bytes don't decode to a call on this runtime." }
    }
    if (u8aToHex(inner.toU8a()) !== text.toLowerCase()) {
      return { ok: false, error: "These bytes don't decode to exactly one call." }
    }
    const name = `${inner.section}.${inner.method}`
    if (kind === "raw") return { ok: true, bytes: inner.toU8a(), summary: name }
    const hash = callHash(inner.toU8a())
    const call = api.tx.whitelist!.whitelistCall!(hash).method
    return { ok: true, bytes: call.toU8a(), summary: `whitelist.whitelistCall(${name})`, hash }
  }, [api, input, kind])

  const tx = useExtrinsic({
    build: (a) => {
      if (!parsed.ok) throw new Error("Enter a call first.")
      return buildFellowshipSubmit(a, { origin, callBytes: parsed.bytes, enactAfter })
    },
    onStatus(s) {
      if (s.kind === "error") toast.error("Filing failed", { description: s.message })
    },
    onSuccess({ events }) {
      void queryClient.invalidateQueries({ queryKey: ["fellowship", chain.id] })
      const index = extractFellowshipIndex(events)
      if (index != null) router.push(`/fellowship/${index}?network=${chain.id}`)
    },
  })

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-2xl mx-auto space-y-6">
          <Link
            href={`/fellowship?network=${chain.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Fellowship
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">New fellowship referendum</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Members of rank {rankNumeral(MIN_SUBMIT_RANK)} and up may file. The track decides who
              votes on it.
            </p>
          </div>

          <section className="rounded-2xl bg-card border border-border p-5 space-y-3">
            <p className="text-xs font-medium text-foreground">Proposal type</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "whitelist", label: "Whitelist a call", sub: "For the public fast track" },
                  { id: "raw", label: "Raw call", sub: "Runs with the Fellowship's origin" },
                ] as const
              ).map((k) => (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={cn(
                    "text-left rounded-xl border px-3 py-2.5",
                    kind === k.id ? "border-purple-border bg-primary/8" : "border-border hover:bg-surface-1",
                  )}
                >
                  <p className="text-sm font-medium text-foreground">{k.label}</p>
                  <p className="text-[11px] text-muted-foreground">{k.sub}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-card border border-border p-5 space-y-3">
            <label className="text-xs font-medium text-foreground" htmlFor="fellowship-call">
              {kind === "whitelist" ? "Call data or call hash to whitelist" : "Call data"}
            </label>
            <textarea
              id="fellowship-call"
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0x…"
              className={cn(INPUT, "resize-y")}
            />
            {parsed.ok ? (
              <div className="rounded-xl bg-surface-1 border border-border px-3.5 py-2.5 text-xs space-y-1">
                <p className="font-mono text-foreground break-all">{parsed.summary}</p>
                {parsed.hash && (
                  <p className="text-muted-foreground">
                    Call hash <span className="font-mono break-all">{parsed.hash}</span>
                  </p>
                )}
                <p className="text-muted-foreground">
                  {parsed.bytes.length} bytes · {parsed.bytes.length <= 128 ? "inline" : "noted as a preimage"}
                </p>
              </div>
            ) : parsed.error ? (
              <p className="text-[11px] text-destructive">{parsed.error}</p>
            ) : null}
            {kind === "whitelist" && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Once this passes, a public referendum on the WhitelistedCaller track can dispatch
                exactly this call as Root, with a 10-minute confirmation instead of Root&apos;s day.
              </p>
            )}
          </section>

          <section className="rounded-2xl bg-card border border-border p-5 space-y-3">
            <label className="text-xs font-medium text-foreground" htmlFor="fellowship-track">
              Submission origin (track)
            </label>
            <select
              id="fellowship-track"
              value={trackId}
              onChange={(e) => setTrackId(Number(e.target.value))}
              className={cn(INPUT, "font-sans")}
            >
              {FELLOWSHIP_ORIGINS.map((o) => {
                const label = fellowshipTrackLabel(
                  tracks.find((x) => x.id === o.trackId),
                  o.trackId,
                )
                return (
                  <option key={o.origin} value={o.trackId}>
                    {o.origin === label ? label : `${o.origin} · ${label}`} · rank{" "}
                    {rankNumeral(o.trackId)}+
                  </option>
                )
              })}
            </select>
            {track && (
              <p className="text-[11px] text-muted-foreground">
                Decide {formatBlockDuration(track.decisionPeriod)} · confirm{" "}
                {formatBlockDuration(track.confirmPeriod)} · decision deposit{" "}
                {formatTokenAmount(track.decisionDeposit, chain, { maxFractionDigits: 0 })}, placed
                later on the F# page. Submitting costs no deposit.
              </p>
            )}
            <label className="text-xs font-medium text-foreground block pt-1" htmlFor="fellowship-enact">
              Enact after (blocks)
            </label>
            <input
              id="fellowship-enact"
              inputMode="numeric"
              value={enactInput}
              placeholder={String(track?.minEnactmentPeriod ?? 10)}
              onChange={(e) => setEnactInput(e.target.value.replace(/\D/g, ""))}
              className={INPUT}
            />
          </section>

          <section className="rounded-2xl bg-card border border-border p-5 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Your rank</span>
              {rank != null ? <RankBadge rank={rank} /> : <span className="text-muted-foreground">Not a member</span>}
            </div>
            {!connected ? (
              <button
                onClick={() => setWalletOpen(true)}
                className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim"
              >
                Connect Wallet
              </button>
            ) : (
              <>
                {!mayFile && (
                  <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    Only members of rank {rankNumeral(MIN_SUBMIT_RANK)} or higher may file; the runtime
                    refuses anyone else.
                  </p>
                )}
                <button
                  onClick={async () => {
                    sign.open()
                    try {
                      await tx.submit()
                    } catch {
                      // Shown by the status callback.
                    }
                  }}
                  disabled={!mayFile || !parsed.ok || tx.isSubmitting}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2",
                    mayFile && parsed.ok && !tx.isSubmitting
                      ? "bg-primary text-primary-foreground hover:bg-purple-dim glow-purple-sm"
                      : "bg-surface-2 text-muted-foreground cursor-not-allowed",
                  )}
                >
                  <ShieldCheck className="w-4 h-4" />
                  {tx.isSubmitting ? "Submitting…" : "File fellowship referendum"}
                </button>
              </>
            )}
          </section>
        </div>
      </main>
      <Footer />
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the fellowship referendum in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Fellowship referendum filed"
        successBody="Opening its page. Place the decision deposit there to start deciding."
        successAt="in-block"
        autoDismiss
        onClose={sign.close}
        onRetry={() => {
          tx.reset()
          void tx.submit()
        }}
      />
    </div>
  )
}

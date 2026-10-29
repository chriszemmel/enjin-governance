"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Lock, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import type { ApiPromise } from "@polkadot/api"
import type { Call } from "@polkadot/types/interfaces"
import { isHex, u8aToHex } from "@polkadot/util"
import { RankBadge } from "@/components/fellowship/rank-badge"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { formatBlockDuration, formatTokenAmount } from "@/lib/chain/format"
import { isValidAddressForChain, samePublicKey } from "@/lib/chain/ss58"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  buildFellowshipSubmit,
  extractFellowshipIndex,
  FELLOWSHIP_ORIGINS,
  fellowshipTrackLabel,
  MIN_SUBMIT_RANK,
  originTrack,
  rankName,
  rankNumeral,
  recommendedOrigin,
  type MemberAction,
} from "@/lib/governance/fellowship"
import { callHash } from "@/lib/governance/whitelist"
import { useApi } from "@/lib/query/hooks/use-api"
import {
  useFellowshipMembers,
  useFellowshipTracks,
  useMyRank,
} from "@/lib/query/hooks/use-fellowship"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { useWallet } from "@/lib/wallet/use-wallet"
import { cn } from "@/lib/utils"

type Kind = "whitelist" | "removeWhitelisted" | "member" | "raw"

const KINDS: { id: Kind; label: string; help: string }[] = [
  {
    id: "whitelist",
    label: "Whitelist a call",
    help: "Vouch for one exact call, so a public referendum can dispatch it on the WhitelistedCaller track.",
  },
  {
    id: "removeWhitelisted",
    label: "Remove a whitelisted call",
    help: "Take back a whitelisted call before a public referendum dispatches it.",
  },
  {
    id: "member",
    label: "Member change",
    help: "Add a member, promote, demote or remove one. The rank involved decides the origin.",
  },
  {
    id: "raw",
    label: "Raw call",
    help: "Paste any call to run with the Fellowship origin you pick below.",
  },
]

/**
 * One origin per track, in track order. Member changes check the rank
 * behind the origin, which only the FellowshipNDan origins carry; every
 * other call takes the named ones where a track has one.
 */
const NAMED_ORIGINS = FELLOWSHIP_ORIGINS.map((o) => o.origin)
const DAN_ORIGINS = ["FellowshipInitiates", ...Array.from({ length: 9 }, (_, i) => `Fellowship${i + 1}Dan`)]

type Parsed =
  | { ok: true; bytes: Uint8Array; call: string; hash?: `0x${string}`; inner?: string }
  | { ok: false; error: string | null }

const INPUT =
  "w-full px-3.5 py-2.5 rounded-xl bg-surface-1 border border-border text-sm text-foreground font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"

function decodeCall(api: ApiPromise, hex: string): Call | string {
  try {
    const call = api.createType("Call", hex) as unknown as Call
    return u8aToHex(call.toU8a()) === hex.toLowerCase()
      ? call
      : "These bytes don't decode to exactly one call."
  } catch {
    return "These bytes don't decode to a call on this runtime."
  }
}

/**
 * The Fellowship chamber: file a fellowship referendum. Pick what it does
 * (whitelist a call, remove one, change a member, or a raw call), check the
 * call, then the origin, which sets the track and who may vote. The origin
 * the runtime requires for the call is marked Recommended and preselected.
 */
export function FellowshipChamber() {
  const chain = useActiveChain()
  const router = useRouter()
  const queryClient = useQueryClient()
  const api = useApi().data
  const { status, activeAddress, session } = useWallet()
  const walletMeta = walletDisplayFor(session ?? null)
  const connected = status === "connected" && !!activeAddress
  const { rank } = useMyRank(activeAddress)
  const members = useFellowshipMembers().data
  const tracks = useFellowshipTracks().data ?? []
  const sign = useSignFlow()
  const [walletOpen, setWalletOpen] = useState(false)
  const [kind, setKind] = useState<Kind>("whitelist")
  const [input, setInput] = useState("")
  const [action, setAction] = useState<MemberAction>("add")
  const [who, setWho] = useState("")
  const [enactInput, setEnactInput] = useState("")

  const memberRank = useMemo(() => {
    const target = who.trim()
    if (!target || !members) return null
    return members.find((m) => samePublicKey(m.address, target))?.rank ?? null
  }, [who, members])

  const recommended = recommendedOrigin(kind, { action, rank: memberRank })
  const [origin, setOrigin] = useState<string>("Fellows")
  const origins = kind === "member" ? DAN_ORIGINS : NAMED_ORIGINS
  useEffect(() => {
    if (recommended) setOrigin(recommended)
    else setOrigin((o) => (origins.includes(o) ? o : origins[3]!))
  }, [recommended, origins])
  const trackId = originTrack(origin) ?? 3
  const track = tracks.find((t) => t.id === trackId) ?? null
  const enactAfter = Number(enactInput || track?.minEnactmentPeriod || 10)
  const mayFile = rank != null && rank >= MIN_SUBMIT_RANK

  const parsed: Parsed = useMemo(() => {
    if (!api) return { ok: false, error: null }
    if (kind === "member") {
      const target = who.trim()
      if (!target) return { ok: false, error: null }
      if (!isValidAddressForChain(target, chain.id)) {
        return { ok: false, error: `Not an address on ${chain.name}.` }
      }
      if (action === "add" && memberRank != null) return { ok: false, error: "Already a member." }
      if (action !== "add" && memberRank == null) return { ok: false, error: "Not a member." }
      if (action === "promote" && memberRank === 9) return { ok: false, error: "Already rank IX." }
      const c = api.tx.fellowshipCollective!
      const call =
        action === "add"
          ? c.addMember!(target)
          : action === "promote"
            ? c.promoteMember!(target)
            : action === "demote"
              ? c.demoteMember!(target)
              : c.removeMember!(target, memberRank!)
      return { ok: true, bytes: call.method.toU8a(), call: `fellowshipCollective.${call.method.method}` }
    }
    const text = input.trim()
    if (!text) return { ok: false, error: null }
    if (!isHex(text)) return { ok: false, error: "Paste hex, starting with 0x." }
    const wrap = kind === "whitelist" ? "whitelistCall" : kind === "removeWhitelisted" ? "removeWhitelistedCall" : null
    if (wrap && text.length === 66) {
      const hash = text.toLowerCase() as `0x${string}`
      const call = api.tx.whitelist![wrap]!(hash).method
      return { ok: true, bytes: call.toU8a(), call: `whitelist.${wrap}`, hash }
    }
    const decoded = decodeCall(api, text)
    if (typeof decoded === "string") return { ok: false, error: decoded }
    const name = `${decoded.section}.${decoded.method}`
    if (!wrap) return { ok: true, bytes: decoded.toU8a(), call: name }
    const hash = callHash(decoded.toU8a())
    const call = api.tx.whitelist![wrap]!(hash).method
    return { ok: true, bytes: call.toU8a(), call: `whitelist.${wrap}`, hash, inner: name }
  }, [api, input, kind, who, action, memberRank, chain.id, chain.name])

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

  const help = KINDS.find((k) => k.id === kind)!.help

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-card border border-border p-5 space-y-3">
        <p className="text-sm font-medium text-foreground">Proposal type</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => setKind(k.id)}
              className={cn(
                "text-left rounded-xl border px-3.5 py-2.5 text-sm transition-colors",
                kind === k.id
                  ? "border-purple-border bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-surface-1 hover:text-foreground",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{help}</p>
      </section>

      <section className="rounded-2xl bg-card border border-border p-5 space-y-3">
        <p className="text-sm font-medium text-foreground">Call</p>
        {kind === "member" ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(["add", "promote", "demote", "remove"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs capitalize",
                    action === a
                      ? "border-purple-border bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-surface-1",
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
            <label className="text-xs text-muted-foreground block" htmlFor="fellowship-who">
              Member address
            </label>
            <input
              id="fellowship-who"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder={chain.id.startsWith("enjin") ? "en…" : "cn…"}
              className={INPUT}
            />
            {memberRank != null && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                Current rank <RankBadge rank={memberRank} />
              </p>
            )}
          </>
        ) : (
          <>
            <label className="text-xs text-muted-foreground block" htmlFor="fellowship-call">
              {kind === "raw" ? "Call data" : `Call to ${kind === "whitelist" ? "whitelist" : "remove"}`}
              <span className="float-right">
                {kind === "raw" ? "Paste a call" : "Paste a call or hash"}
              </span>
            </label>
            <textarea
              id="fellowship-call"
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0x…"
              className={cn(INPUT, "resize-y")}
            />
          </>
        )}
        {parsed.ok ? (
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-4 gap-y-1.5 text-xs pt-1">
            <dt className="text-muted-foreground">Call</dt>
            <dd className="font-mono text-foreground break-all">{parsed.call}</dd>
            {parsed.hash && (
              <>
                <dt className="text-muted-foreground">Call hash</dt>
                <dd className="font-mono text-foreground break-all">{parsed.hash}</dd>
              </>
            )}
            {parsed.inner && (
              <>
                <dt className="text-muted-foreground">
                  {kind === "whitelist" ? "Whitelists" : "Removes"}
                </dt>
                <dd className="font-mono text-foreground break-all">{parsed.inner}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Size</dt>
            <dd className="font-mono text-foreground">
              {parsed.bytes.length} bytes · {parsed.bytes.length <= 128 ? "inline" : "noted as a preimage"}
            </dd>
          </dl>
        ) : parsed.error ? (
          <p className="text-xs text-destructive">{parsed.error}</p>
        ) : null}
      </section>

      <section className="rounded-2xl bg-card border border-border p-5 space-y-3">
        <p className="text-sm font-medium text-foreground">Submission origin (track)</p>
        <div className="space-y-1.5" role="radiogroup" aria-label="Submission origin">
          {origins.map((o) => {
            const t = originTrack(o)!
            const selected = origin === o
            return (
              <button
                key={o}
                role="radio"
                aria-checked={selected}
                onClick={() => setOrigin(o)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl border px-3.5 py-2 text-left text-xs",
                  selected ? "border-purple-border bg-primary/10" : "border-border hover:bg-surface-1",
                )}
              >
                <span className={cn("font-mono", selected ? "text-foreground" : "text-muted-foreground")}>
                  {o}
                </span>
                <span className="text-muted-foreground truncate">
                  {fellowshipTrackLabel(tracks.find((x) => x.id === t), t)} · rank {rankNumeral(t)}+
                </span>
                {o === recommended && (
                  <span className="ml-auto text-primary font-medium whitespace-nowrap">Recommended</span>
                )}
              </button>
            )
          })}
        </div>
        {kind === "member" && !recommended && parsed.ok && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            No fellowship origin can make this change at rank {rankNumeral(memberRank ?? 0)}.
          </p>
        )}
        {track && (
          <p className="text-[11px] text-muted-foreground">
            Rank {rankNumeral(trackId)} ({rankName(trackId)}) and up vote. Decide{" "}
            {formatBlockDuration(track.decisionPeriod)} · confirm {formatBlockDuration(track.confirmPeriod)} ·
            decision deposit {formatTokenAmount(track.decisionDeposit, chain, { maxFractionDigits: 0 })},
            placed later on the F# page. Submitting costs no deposit.
          </p>
        )}
        <label className="text-xs text-muted-foreground block pt-1" htmlFor="fellowship-enact">
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
        <div className="rounded-xl bg-surface-2 px-3.5 py-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Your rank</span>
          {rank != null ? (
            <RankBadge rank={rank} />
          ) : (
            <span className="text-muted-foreground">{connected ? "Not a member" : "Not connected"}</span>
          )}
        </div>
        {!connected ? (
          <button
            onClick={() => setWalletOpen(true)}
            className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim glow-purple-sm"
          >
            Connect Wallet
          </button>
        ) : (
          <>
            {!mayFile && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
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

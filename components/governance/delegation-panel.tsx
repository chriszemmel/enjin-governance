"use client"

import { useMemo, useRef, useState } from "react"
import { Loader2, Users } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { formatTokenAmount, parseTokenAmount } from "@/lib/chain/format"
import { isValidAddressForChain, samePublicKey, shortenAddress } from "@/lib/chain/ss58"
import {
  buildDelegate,
  buildUndelegate,
  sEnjCurrency,
  type VoteCurrency,
} from "@/lib/governance/conviction-voting"
import { decodeCurrency } from "@/lib/governance/vote-decode"
import { formatTrackName } from "@/lib/governance/display"
import {
  CONVICTION_MULTIPLIER,
  CONVICTIONS,
  type Conviction,
} from "@/lib/governance/types"
import { useAccountLocks } from "@/lib/query/hooks/use-account-locks"
import { useBalance } from "@/lib/query/hooks/use-balance"
import { useDelegations } from "@/lib/query/hooks/use-delegations"
import { usePoolNft } from "@/lib/query/hooks/use-pool-nft"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { cn } from "@/lib/utils"

/** Map a stored currency variant back to the arg buildUndelegate expects. */
function currencyFromRaw(raw: unknown): VoteCurrency {
  const c = decodeCurrency(raw)
  return c.kind === "SEnj" && c.poolId != null ? sEnjCurrency(c.poolId) : { Enj: null }
}

/** Stable text key for a currency (used as a React key, where async pool
 * names would be unstable). */
function currencyKey(raw: unknown): string {
  const c = decodeCurrency(raw)
  return c.kind === "SEnj" && c.poolId != null ? `senj-${c.poolId}` : "enj"
}

/** Display label for a delegation's currency: "ENJ" or "sENJ · <pool name>",
 * resolving the staking pool's name and falling back to "Pool #N". */
function CurrencyLabel({ raw }: { raw: unknown }) {
  const c = decodeCurrency(raw)
  const poolId = c.kind === "SEnj" && c.poolId != null ? c.poolId : null
  const { data } = usePoolNft(poolId)
  if (poolId === null) return <>ENJ</>
  return <>sENJ · {data?.pool.name ?? `Pool #${poolId}`}</>
}

type ActiveUndelegate = {
  key: string
  trackId: number
  currency: VoteCurrency
  toastId: string
}

/**
 * Account-level delegation manager: lists active delegations (per track and
 * currency) with one-click undelegate, plus a form to delegate ENJ voting
 * power on a track to another account.
 *
 * The undelegate extrinsic + sign modal live at panel level, not inside a row:
 * the delegations list auto-refetches on window focus (e.g. returning from the
 * wallet app), at which point the just-removed delegation drops out and its row
 * unmounts. A modal rendered inside the row would vanish mid-success; here it
 * survives until the user dismisses it.
 */
export function DelegationPanel({ address }: { address: string }) {
  const chain = useActiveChain()
  const queryClient = useQueryClient()
  const delegationsQuery = useDelegations(address)
  const tracksQuery = useTracks()
  const delegations = useMemo(
    () => delegationsQuery.data ?? [],
    [delegationsQuery.data],
  )
  const trackName = (id: number) =>
    tracksQuery.data?.find((t) => t.id === id)?.name ?? `Track ${id}`

  const { session: walletSession } = useWallet()
  const sign = useSignFlow()
  const walletMeta = walletDisplayFor(walletSession ?? null)
  const [active, setActive] = useState<ActiveUndelegate | null>(null)
  const activeRef = useRef<ActiveUndelegate | null>(null)

  const tx = useExtrinsic({
    build: (api) => {
      const a = activeRef.current
      if (!a) throw new Error("No delegation selected")
      return buildUndelegate(api, a.trackId, a.currency)
    },
    onStatus(status) {
      const id = activeRef.current?.toastId
      if (id && status.kind === "error" && !sign.isWalletConnect) {
        toast.error("Undelegate failed", { id, description: status.message })
      }
    },
    onSuccess() {
      // Balance can refresh now; the delegations list waits until the modal
      // closes so the user keeps seeing the success card.
      void queryClient.invalidateQueries({ queryKey: ["balance"] })
    },
  })

  const startUndelegate = (d: { trackId: number; currencyRaw: unknown }) => {
    const currency = currencyFromRaw(d.currencyRaw)
    const toastId =
      "SEnj" in currency
        ? `undelegate-${d.trackId}-senj-${currency.SEnj.tokenId}`
        : `undelegate-${d.trackId}-enj`
    const a: ActiveUndelegate = {
      key: `${d.trackId}-${currencyKey(d.currencyRaw)}`,
      trackId: d.trackId,
      currency,
      toastId,
    }
    activeRef.current = a
    setActive(a)
    sign.open()
    void tx.submit()
  }

  const closeModal = () => {
    sign.close()
    activeRef.current = null
    setActive(null)
    void queryClient.invalidateQueries({
      queryKey: ["delegations", chain.id, address],
    })
  }

  return (
    <section className="rounded-2xl bg-card border border-border p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Delegation</h2>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Delegate your voting power on a track to another account - they vote on
        your behalf with your balance and conviction. The balance is locked just
        like a direct vote until you undelegate.
      </p>

      {delegationsQuery.isPending ? (
        <div className="flex h-14 items-center gap-2 rounded-xl border border-border bg-surface-1 px-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Checking delegations…</p>
        </div>
      ) : delegations.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-xl border border-border bg-surface-1 px-4 py-3">
          You aren&apos;t delegating on any track.
        </p>
      ) : (
        <ul className="space-y-2">
          {delegations.map((d) => {
            const key = `${d.trackId}-${currencyKey(d.currencyRaw)}`
            return (
              <li
                key={key}
                className="flex items-center gap-3 p-3 rounded-lg bg-surface-1 border border-border"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    <span className="font-mono">{formatTokenAmount(d.balance, chain)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatTrackName(trackName(d.trackId))}
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    → {shortenAddress(d.target)} · {convictionLabel(d.conviction)} ·{" "}
                    <CurrencyLabel raw={d.currencyRaw} />
                  </p>
                </div>
                <UndelegateButton
                  onClick={() => startUndelegate(d)}
                  submitting={active?.key === key && tx.isSubmitting}
                />
              </li>
            )
          })}
        </ul>
      )}

      <DelegateForm
        address={address}
        existingTrackIds={new Set(delegations.map((d) => d.trackId))}
      />

      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve removing the delegation in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Delegation removed"
        successBody={`Removed on ${chain.shortName}.`}
        successAt="in-block"
        autoDismiss={false}
        onClose={closeModal}
        onRetry={() => {
          tx.reset()
          void tx.submit()
        }}
      />
    </section>
  )
}

function convictionLabel(c: Conviction): string {
  return `${CONVICTION_MULTIPLIER[c]}x`
}

function DelegateForm({
  address,
  existingTrackIds,
}: {
  address: string
  existingTrackIds: Set<number>
}) {
  const chain = useActiveChain()
  const queryClient = useQueryClient()
  const tracksQuery = useTracks()
  const balanceQuery = useBalance(address)
  const { session: walletSession } = useWallet()
  const sign = useSignFlow()
  const walletMeta = walletDisplayFor(walletSession ?? null)

  const tracks = useMemo(() => tracksQuery.data ?? [], [tracksQuery.data])
  // "all" batches a delegate per eligible track; a number targets one track.
  const [selection, setSelection] = useState<"all" | number>("all")
  const [target, setTarget] = useState("")
  const [conviction, setConviction] = useState<Conviction>("Locked1x")
  const [amount, setAmount] = useState("")

  // Tracks the user currently has an active (casting) vote on - delegating
  // those errors with AlreadyVoting, so they're not eligible for delegation.
  const locksQuery = useAccountLocks(address)
  const activeVoteTrackIds = useMemo(
    () =>
      new Set(
        (locksQuery.data ?? [])
          .filter((l) => l.activeVotes.length > 0)
          .map((l) => l.trackId),
      ),
    [locksQuery.data],
  )

  // For "All tracks": every track not already delegated and not actively voted.
  const eligibleTracks = useMemo(
    () =>
      tracks.filter(
        (t) => !existingTrackIds.has(t.id) && !activeVoteTrackIds.has(t.id),
      ),
    [tracks, existingTrackIds, activeVoteTrackIds],
  )

  const parsedAmount = useMemo(() => {
    if (!amount.trim()) return null
    try {
      return parseTokenAmount(amount, chain)
    } catch {
      return null
    }
  }, [amount, chain])

  const free = balanceQuery.data ?? null
  const targetValid = target.trim().length > 0 && isValidAddressForChain(target.trim(), chain.id)
  const targetIsSelf = targetValid && samePublicKey(target.trim(), address)
  const amountValid = parsedAmount != null && parsedAmount > 0n
  const exceedsBalance = parsedAmount != null && free != null && parsedAmount > free

  // Tracks this submission will actually delegate.
  const targetTrackIds =
    selection === "all" ? eligibleTracks.map((t) => t.id) : [selection]
  const singleConflict =
    typeof selection === "number" &&
    (existingTrackIds.has(selection) || activeVoteTrackIds.has(selection))
  const noEligibleTracks = selection === "all" && eligibleTracks.length === 0

  const error = noEligibleTracks
    ? "No eligible tracks - you're already delegating or voting on all of them."
    : singleConflict
      ? "Already delegating or voting on this track - resolve that first."
      : !target.trim()
        ? null
        : !targetValid
          ? "Enter a valid address for this chain."
          : targetIsSelf
            ? "You can't delegate to your own account."
            : !amountValid
              ? null
              : exceedsBalance
                ? "Amount exceeds your free balance."
                : null

  const canSubmit =
    targetTrackIds.length > 0 &&
    !singleConflict &&
    targetValid &&
    !targetIsSelf &&
    amountValid &&
    !exceedsBalance

  const tx = useExtrinsic({
    build: (api) => {
      if (targetTrackIds.length === 0 || parsedAmount == null) {
        throw new Error("Complete the delegation form.")
      }
      // One delegate per track; an array is auto-wrapped in utility.batchAll
      // by useExtrinsic (all-or-nothing). A single track returns one call.
      const calls = targetTrackIds.map((id) =>
        buildDelegate(api, {
          trackId: id,
          to: target.trim(),
          conviction,
          balance: parsedAmount,
        }),
      )
      return calls.length === 1 ? calls[0]! : calls
    },
    onStatus(status) {
      if (status.kind === "error" && !sign.isWalletConnect) {
        toast.error("Delegation failed", { id: "delegate-tx", description: status.message })
      }
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ["delegations", chain.id, address] })
      void queryClient.invalidateQueries({ queryKey: ["balance"] })
      setTarget("")
      setAmount("")
    },
  })

  const handleSubmit = () => {
    if (!canSubmit) return
    sign.open()
    void tx.submit()
  }

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4 space-y-3">
      <p className="text-xs font-medium text-foreground">Delegate ENJ voting power</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground">Track</span>
          <select
            value={selection === "all" ? "all" : selection}
            onChange={(e) =>
              setSelection(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-foreground focus:outline-none focus:border-primary/50"
          >
            <option value="all">
              All tracks{eligibleTracks.length > 0 ? ` (${eligibleTracks.length})` : ""}
            </option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {formatTrackName(t.name)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground">Conviction</span>
          <select
            value={conviction}
            onChange={(e) => setConviction(e.target.value as Conviction)}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-foreground focus:outline-none focus:border-primary/50"
          >
            {CONVICTIONS.map((c) => (
              <option key={c} value={c}>
                {convictionLabel(c)} {c === "None" ? "(no lock)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted-foreground">Delegate to (address)</span>
        <input
          type="text"
          value={target}
          spellCheck={false}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="en…"
          className={cn(
            "w-full px-3 py-2 rounded-lg bg-surface-2 border text-sm text-foreground font-mono focus:outline-none focus:ring-1",
            target.trim() && (!targetValid || targetIsSelf)
              ? "border-destructive/50 focus:ring-destructive/30"
              : "border-border focus:border-primary/50 focus:ring-primary/20",
          )}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted-foreground">
          Amount ({chain.ticker})
          {free != null && (
            <span className="text-muted-foreground/70">
              {" "}
              · free {formatTokenAmount(free, chain)}
            </span>
          )}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 100"
          className={cn(
            "w-full px-3 py-2 rounded-lg bg-surface-2 border text-sm text-foreground font-mono focus:outline-none focus:ring-1",
            exceedsBalance
              ? "border-destructive/50 focus:ring-destructive/30"
              : "border-border focus:border-primary/50 focus:ring-primary/20",
          )}
        />
      </label>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {!error && selection === "all" && targetTrackIds.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Delegates across all {targetTrackIds.length}{" "}
          eligible tracks in one signature. Your balance locks once - it
          isn&apos;t multiplied per track.
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit || tx.isSubmitting}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {tx.isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {selection === "all" ? "Delegate all tracks" : "Delegate"}
      </button>

      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the delegation in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Delegation set"
        successBody={`Voting power delegated on ${chain.shortName}.`}
        successAt="in-block"
        autoDismiss={false}
        onClose={sign.close}
        onRetry={() => {
          tx.reset()
          void tx.submit()
        }}
      />
    </div>
  )
}

function UndelegateButton({
  onClick,
  submitting,
}: {
  onClick: () => void
  submitting: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={submitting}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-purple-border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      title="Remove this delegation (your balance returns to a normal lock you can unlock once expired)."
    >
      {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
      Undelegate
    </button>
  )
}

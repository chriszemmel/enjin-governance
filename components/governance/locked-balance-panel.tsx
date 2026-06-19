"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Loader2, Lock, Unlock } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { formatRelativeBlockTime, formatTokenAmount } from "@/lib/chain/format"
import {
  buildUnlock,
  sEnjCurrency,
  type TrackLock,
  type VoteCurrency,
} from "@/lib/governance/conviction-voting"
import { decodeCurrency } from "@/lib/governance/vote-decode"
import { useAccountLocks } from "@/lib/query/hooks/use-account-locks"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import { usePoolNft } from "@/lib/query/hooks/use-pool-nft"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { EnjAvatar } from "@/components/governance/enj-avatar"
import { PoolNftAvatar } from "@/components/governance/pool-nft-avatar"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"

/** Stable per-row key (one row per track + currency). */
function lockKey(lock: TrackLock): string {
  const d = decodeCurrency(lock.currencyRaw)
  return d.kind === "SEnj"
    ? `${lock.trackId}-senj-${d.poolId}`
    : `${lock.trackId}-enj`
}

/** Currency arg the unlock extrinsic needs for this lock. */
function lockCurrency(lock: TrackLock): VoteCurrency {
  const d = decodeCurrency(lock.currencyRaw)
  return d.kind === "SEnj" ? sEnjCurrency(d.poolId) : { Enj: null }
}

type ActiveUnlock = {
  key: string
  trackId: number
  currency: VoteCurrency
  toastId: string
}

/**
 * Shows the connected wallet's conviction-voting locks per track and lets
 * them free the balance once a lock has expired. A lock holds until the
 * vote is removed AND the conviction period passes, so we surface the
 * real state (held by an active vote / counting down / unlockable now)
 * rather than a button that silently no-ops.
 *
 * The unlock extrinsic + sign modal live HERE, at panel level, not inside a
 * row. A row unmounts the moment its lock leaves the list - and the locks
 * query auto-refetches (on window focus, e.g. returning from the wallet app,
 * and every 24s), at which point the just-freed lock drops out. A modal
 * rendered inside the row would vanish mid-success; at panel level it survives
 * until the user dismisses it.
 */
export function LockedBalancePanel({ address }: { address: string }) {
  const chain = useActiveChain()
  const queryClient = useQueryClient()
  const locksQuery = useAccountLocks(address)
  const blockQuery = useCurrentBlock()
  const locks = useMemo(() => locksQuery.data ?? [], [locksQuery.data])

  const { session: walletSession } = useWallet()
  const sign = useSignFlow()
  const walletMeta = walletDisplayFor(walletSession ?? null)

  // The active unlock. Held in a ref too so `build` / status callbacks read it
  // synchronously (state updates are async, the submit fires immediately).
  const [active, setActive] = useState<ActiveUnlock | null>(null)
  const activeRef = useRef<ActiveUnlock | null>(null)

  const tx = useExtrinsic({
    build: (api) => {
      const a = activeRef.current
      if (!a) throw new Error("No lock selected")
      return buildUnlock(api, a.trackId, address, a.currency)
    },
    onStatus(status) {
      const id = activeRef.current?.toastId
      if (!id) return
      if (status.kind === "finalized") {
        toast.success("Unlock finalised on chain", {
          id,
          description: `Balance freed on ${chain.shortName}.`,
        })
        return
      }
      if (sign.isWalletConnect) return
      if (status.kind === "signing") {
        toast.dismiss(id)
        toast.loading("Waiting for wallet signature…", { id, description: "" })
      } else if (status.kind === "broadcast") {
        toast.dismiss(id)
        toast.loading("Broadcasting…", { id, description: "" })
      } else if (status.kind === "error") {
        toast.dismiss(id)
        toast.error("Unlock failed", { id, description: status.message })
      }
    },
    onSuccess() {
      // Balance can refresh now; the locks list is left until the modal closes
      // so the user keeps seeing the success card.
      void queryClient.invalidateQueries({ queryKey: ["balance"] })
      if (sign.isWalletConnect) return
      const id = activeRef.current?.toastId
      if (!id) return
      toast.dismiss(id)
      toast.success("Balance unlocked", {
        id,
        description: `Freed on ${chain.shortName}.`,
      })
    },
  })

  const startUnlock = (lock: TrackLock) => {
    const currency = lockCurrency(lock)
    const toastId =
      "SEnj" in currency
        ? `unlock-${lock.trackId}-senj-${currency.SEnj.tokenId}`
        : `unlock-${lock.trackId}-enj`
    const a: ActiveUnlock = { key: lockKey(lock), trackId: lock.trackId, currency, toastId }
    activeRef.current = a
    setActive(a)
    sign.open()
    void tx.submit()
  }

  const closeModal = () => {
    sign.close()
    activeRef.current = null
    setActive(null)
    // Safe to refetch now - the freed lock drops out and its row unmounts.
    void queryClient.invalidateQueries({
      queryKey: ["account-locks", chain.id, address],
    })
  }

  return (
    <section className="rounded-2xl bg-card border border-border p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Locked balance</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Conviction votes lock your balance per track. Once a vote is removed
          and its lock period ends, you can free the balance here.
        </p>
      </div>

      {locksQuery.isPending ? (
        <div className="flex h-16 items-center gap-2 rounded-xl border border-border bg-surface-1 px-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Checking your locks…</p>
        </div>
      ) : locks.length === 0 ? (
        <div className="flex h-16 items-center rounded-xl border border-border bg-surface-1 px-4">
          <p className="text-xs text-muted-foreground">
            No conviction locks on {chain.shortName}.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {locks.map((lock) => {
            const key = lockKey(lock)
            return (
              <LockRow
                key={key}
                lock={lock}
                currentBlock={blockQuery.data ?? null}
                onUnlock={() => startUnlock(lock)}
                submitting={active?.key === key && tx.isSubmitting}
              />
            )
          })}
        </ul>
      )}

      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the unlock in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Balance unlocked"
        successBody={`Freed on ${chain.shortName}.`}
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

/** Pool name suffix for an sENJ lock, e.g. " · Substreak". Renders the pool
 * id while the on-chain name resolves. Lives in its own component so the
 * usePoolNft hook only runs for sENJ rows. */
function PoolNameSuffix({ poolId }: { poolId: number }) {
  const { data } = usePoolNft(poolId)
  // The staking pool's name ("Substreak"), not the per-NFT metadata name
  // ("Degen #512") - the pool is what identifies the lock source.
  const name = data?.pool.name ?? `Pool #${poolId}`
  return <span className="text-muted-foreground"> · {name}</span>
}

function LockRow({
  lock,
  currentBlock,
  onUnlock,
  submitting,
}: {
  lock: TrackLock
  currentBlock: number | null
  onUnlock: () => void
  submitting: boolean
}) {
  const chain = useActiveChain()
  const decoded = decodeCurrency(lock.currencyRaw)
  const poolId = decoded.kind === "SEnj" ? decoded.poolId : null
  const tokenLabel = poolId !== null ? "sENJ" : chain.ticker
  const hasActive = lock.activeVotes.length > 0
  const counting =
    !hasActive &&
    lock.prior != null &&
    currentBlock != null &&
    currentBlock < lock.prior.unlockAt
  const unlockableNow = !hasActive && !counting

  return (
    <li className="flex items-center gap-3 p-3 rounded-lg bg-surface-1 border border-border min-h-[4.5rem]">
      {poolId !== null ? (
        <PoolNftAvatar poolId={poolId} size="sm" />
      ) : (
        <EnjAvatar size="sm" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">
          <span className="font-mono">
            {formatTokenAmount(lock.locked, chain, { withTicker: false })}{" "}
            {tokenLabel}
          </span>
          {poolId !== null && <PoolNameSuffix poolId={poolId} />}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1">
          {unlockableNow ? (
            <Unlock className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
          ) : (
            <Lock className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
          )}
          <span>
            {hasActive ? (
              <>
                Held by your vote on{" "}
                {lock.activeVotes.map((v, i) => (
                  <span key={v.pollIndex}>
                    {i > 0 ? ", " : ""}
                    <Link
                      href={`/proposals/${v.pollIndex}?network=${chain.id}`}
                      className="text-primary hover:text-purple-dim"
                    >
                      #{v.pollIndex}
                    </Link>
                  </span>
                ))}
                {" - remove it first"}
              </>
            ) : counting && lock.prior ? (
              <>Unlocks {formatRelativeBlockTime(lock.prior.unlockAt, currentBlock)}</>
            ) : (
              "Unlockable now"
            )}
          </span>
        </p>
      </div>
      <UnlockButton onClick={onUnlock} disabled={!unlockableNow} submitting={submitting} />
    </li>
  )
}

function UnlockButton({
  onClick,
  disabled,
  submitting,
}: {
  onClick: () => void
  disabled: boolean
  submitting: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || submitting}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-purple-border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      title={
        disabled
          ? "Nothing to unlock yet - remove the vote and wait for the lock to expire."
          : "Free your unlockable balance on this track."
      }
    >
      {submitting ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Unlock className="w-3 h-3" />
      )}
      Unlock
    </button>
  )
}

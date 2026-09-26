"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, ChevronDown, ChevronUp, Lock, XCircle, Zap } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  formatBlockDuration,
  formatTokenAmount,
  parseTokenAmount,
} from "@/lib/chain/format"
import {
  buildRemoveVote,
  buildVote,
  convictionLockBlocks,
  getVoteLockingPeriod,
  type VoteCurrency,
} from "@/lib/governance/conviction-voting"
import {
  CONVICTION_MULTIPLIER,
  CONVICTIONS,
  type Conviction,
} from "@/lib/governance/types"
import { decodeCurrency } from "@/lib/governance/vote-decode"
import { useApi } from "@/lib/query/hooks/use-api"
import { useBalance } from "@/lib/query/hooks/use-balance"
import { useMyVotesOnPoll } from "@/lib/query/hooks/use-my-votes"
import { useStakedEnjBalances } from "@/lib/query/hooks/use-staked-enj-balances"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useDisplayAddress, useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { CurrentVotesStack } from "./current-votes-stack"
import {
  selectionToVoteCurrency,
  VoteCurrencySelect,
  type SelectedCurrency,
} from "./vote-currency-select"

interface VotingPanelProps {
  referendumIndex: number
  isOngoing: boolean
  /**
   * Unused - conviction locks run in the runtime's voteLockingPeriod, not
   * the track's decision period. Kept until the proposal page stops
   * passing it.
   */
  decisionPeriodBlocks?: number | null
  trackId: number | null
}

const DEFAULT_AMOUNT = "1"

export function VotingPanel({
  referendumIndex,
  isOngoing,
  trackId,
}: VotingPanelProps) {
  const [walletOpen, setWalletOpen] = useState(false)
  const [vote, setVote] = useState<"aye" | "nay" | null>(null)
  const [conviction, setConviction] = useState<Conviction>("Locked1x")
  const [showConviction, setShowConviction] = useState(false)
  const [amountInput, setAmountInput] = useState(DEFAULT_AMOUNT)
  const [amountError, setAmountError] = useState<string | null>(null)

  const chain = useActiveChain()
  const queryClient = useQueryClient()
  // Conviction locks run in the runtime's voteLockingPeriod on every track.
  const voteLockingPeriod = getVoteLockingPeriod(useApi().data)
  const { status: walletStatus, activeAddress, session: walletSession } = useWallet()
  const { short: addressShort } = useDisplayAddress()
  const walletMeta = walletDisplayFor(walletSession ?? null)
  // Two independent sign flows: one for the main vote, one for the remove
  // action. They share the same WC session under the hood but each modal
  // mirrors its own extrinsic's lifecycle.
  const sign = useSignFlow()
  const signRemove = useSignFlow()
  const balanceQuery = useBalance(activeAddress)
  const stakedQuery = useStakedEnjBalances(activeAddress)
  const stakedHoldings = useMemo(
    () => stakedQuery.data ?? [],
    [stakedQuery.data],
  )
  const myVotesQuery = useMyVotesOnPoll(activeAddress, trackId, referendumIndex)
  const myVotes = useMemo(
    () => myVotesQuery.data ?? [],
    [myVotesQuery.data],
  )
  // Terminal referenda don't expose a trackId, but a poll belongs to exactly
  // one track, so recover it from the user's own (persisted) vote record.
  // Lets "remove vote" work in place on concluded referenda instead of
  // dead-ending to the global unlock flow.
  const effectiveTrackId = trackId ?? myVotes[0]?.vote.trackId ?? null
  const connected = walletStatus === "connected" && !!addressShort

  // Default to liquid ENJ; user can flip to a specific sENJ pool from
  // the currency selector if they hold any. Reset to ENJ if the
  // wallet disconnects so we don't reference a stale pool id.
  const [currency, setCurrency] = useState<SelectedCurrency>({
    kind: "Enj",
    freeBalance: null,
  })
  useEffect(() => {
    if (!connected && currency.kind !== "Enj") {
      setCurrency({ kind: "Enj", freeBalance: null })
    }
  }, [connected, currency.kind])
  // Keep the selection's balance fresh from the queries.
  useEffect(() => {
    if (currency.kind === "Enj") {
      const free = balanceQuery.data ?? null
      if (free !== currency.freeBalance) {
        setCurrency({ kind: "Enj", freeBalance: free })
      }
      return
    }
    const match = stakedHoldings.find((h) => h.poolId === currency.poolId)
    if (!match) {
      // The pool dropped out of holdings (transfer? unstake?) - fall
      // back to ENJ rather than leaving a stale option selected.
      setCurrency({ kind: "Enj", freeBalance: balanceQuery.data ?? null })
      return
    }
    if (
      match.senjBalance !== currency.senjBalance ||
      match.realEnjBalance !== currency.realEnjBalance
    ) {
      setCurrency({
        kind: "SEnj",
        poolId: match.poolId,
        poolName: match.poolName,
        senjBalance: match.senjBalance,
        realEnjBalance: match.realEnjBalance,
      })
    }
  }, [balanceQuery.data, stakedHoldings, currency])

  // Match an on-chain vote to the form's currently selected source so
  // the form reads as a "Change vote" for that source. With multi-
  // currency voting a wallet can hold an ENJ vote AND a vote per
  // sENJ pool independently, so the match key is per-source.
  const selectedVote = useMemo(() => {
    return myVotes.find((entry) => {
      const decoded = decodeCurrency(entry.currencyRaw)
      if (currency.kind === "Enj") {
        // Unknown decode also routes to ENJ on stock Substrate where
        // votes have no currency tag.
        return decoded.kind === "Enj" || decoded.kind === "Unknown"
      }
      return decoded.kind === "SEnj" && decoded.poolId === currency.poolId
    })?.vote
  }, [myVotes, currency])

  // Re-hydrate the form whenever the selected source changes, so
  // switching from ENJ to a sENJ pool shows that pool's existing
  // vote (if any) instead of the previous source's.
  const lastHydratedKey = useRef<string | null>(null)
  useEffect(() => {
    const key =
      currency.kind === "Enj" ? "enj" : `senj:${currency.poolId}`
    if (lastHydratedKey.current === key) return
    lastHydratedKey.current = key
    if (selectedVote?.type !== "Standard") return
    setVote(selectedVote.aye ? "aye" : "nay")
    setConviction(selectedVote.conviction)
    const whole = selectedVote.balance / 10n ** BigInt(chain.decimals)
    const frac = selectedVote.balance % 10n ** BigInt(chain.decimals)
    if (frac === 0n) {
      setAmountInput(whole.toString())
    } else {
      const trimmed = frac
        .toString()
        .padStart(chain.decimals, "0")
        .replace(/0+$/, "")
      setAmountInput(`${whole.toString()}.${trimmed}`)
    }
  }, [currency, selectedVote, chain.decimals])

  const multiplier = CONVICTION_MULTIPLIER[conviction]
  const lockLabel =
    conviction === "None"
      ? "No lock"
      : formatBlockDuration(convictionLockBlocks(conviction, voteLockingPeriod))

  let parsedAmount: bigint | null = null
  try {
    parsedAmount = parseTokenAmount(amountInput || "0", chain)
  } catch {
    parsedAmount = null
  }

  // Whichever vote source the user picked is what we validate the
  // amount against - voting 100 sENJ from a pool the wallet doesn't
  // hold would error in-chain at dispatch time.
  const sourceBalance =
    currency.kind === "Enj"
      ? (balanceQuery.data ?? null)
      : currency.senjBalance
  const exceedsBalance =
    parsedAmount != null &&
    sourceBalance != null &&
    parsedAmount > sourceBalance
  // Two-decimal precision is more than enough for the display number,
  // and avoids the Number-precision loss you'd hit doing the divide on
  // an 18-decimal bigint directly.
  const votingPower = (() => {
    if (parsedAmount == null) return 0
    const centi = parsedAmount / 10n ** BigInt(chain.decimals - 2)
    return (Number(centi) / 100) * multiplier
  })()

  const tx = useExtrinsic({
    build: (api) =>
      buildVote(api, {
        pollIndex: referendumIndex,
        aye: vote === "aye",
        balance: parsedAmount ?? 0n,
        conviction,
        currency: selectionToVoteCurrency(currency),
      }),
    onStatus(status) {
      if (status.kind === "finalized") {
        // Passive confirmation that GRANDPA locked it in. Fires for both
        // browser-extension flows (replaces the in-block "Vote submitted"
        // toast under the same id) and WalletConnect mobile (the modal
        // auto-dismissed at in-block, so this is the user's only post-
        // dismissal signal that the chain finalised the vote).
        toast.success("Vote finalised on chain", {
          id: "vote-tx",
          description: subscanExtrinsicUrl(chain, status.txHash),
          action: {
            label: "Subscan",
            onClick: () =>
              window.open(subscanExtrinsicUrl(chain, status.txHash), "_blank"),
          },
        })
        return
      }
      if (sign.isWalletConnect) {
        // The SignRequestModal renders the full lifecycle.
        return
      }
      if (status.kind === "broadcast") {
        toast.loading("Broadcasting vote…", { id: "vote-tx", description: undefined })
      } else if (status.kind === "error") {
        toast.error("Vote failed", { id: "vote-tx", description: status.message })
      }
    },
    onSuccess({ txHash }) {
      // The voter list (`referendum-votes`) and the user's own vote
      // (`my-votes`) aren't covered by use-tx's generic referenda
      // invalidation. Both are scoped to this poll - a vote here can't
      // change the voter set or the user's votes on any other referendum.
      // Fired at in-block so the Tally panel + voter count refresh as
      // soon as the modal flips to the success card.
      void queryClient.invalidateQueries({
        queryKey: ["referendum-votes", chain.id, referendumIndex],
      })
      void queryClient.invalidateQueries({
        queryKey: ["my-votes", chain.id, activeAddress, trackId, referendumIndex],
      })
      void queryClient.invalidateQueries({
        queryKey: ["account-locks", chain.id, activeAddress],
      })
      if (sign.isWalletConnect) return
      toast.success("Vote submitted", {
        id: "vote-tx",
        description: subscanExtrinsicUrl(chain, txHash),
        action: {
          label: "Subscan",
          onClick: () =>
            window.open(subscanExtrinsicUrl(chain, txHash), "_blank"),
        },
      })
    },
  })

  // Separate extrinsic for `removeVote` so it has its own toast id and
  // disabled state without fighting the main vote button. The build
  // closure pulls the active currency from a ref because state
  // updates aren't visible inside the synchronous submit() that
  // follows handleRemoveVote's setter. State drives the UI's
  // "which card is removing" indicator.
  const removingCurrencyRef = useRef<VoteCurrency | null>(null)
  const [removingCurrency, setRemovingCurrency] =
    useState<VoteCurrency | null>(null)
  const removeTx = useExtrinsic({
    build: (api) => {
      if (effectiveTrackId == null) {
        throw new Error("Track id is unknown. Refresh the page.")
      }
      const target = removingCurrencyRef.current
      if (!target) {
        throw new Error("Internal: no source picked for the remove call.")
      }
      return buildRemoveVote(api, effectiveTrackId, referendumIndex, target)
    },
    onStatus(status) {
      if (status.kind === "finalized") {
        toast.success("Vote removal finalised on chain", {
          id: "remove-vote-tx",
          description: subscanExtrinsicUrl(chain, status.txHash),
          action: {
            label: "Subscan",
            onClick: () =>
              window.open(subscanExtrinsicUrl(chain, status.txHash), "_blank"),
          },
        })
        return
      }
      if (signRemove.isWalletConnect) return
      if (status.kind === "broadcast") {
        toast.loading("Broadcasting vote removal…", {
          id: "remove-vote-tx",
          description: undefined,
        })
      } else if (status.kind === "error") {
        toast.error("Could not remove vote", {
          id: "remove-vote-tx",
          description: status.message,
        })
      }
    },
    onSuccess({ txHash }) {
      void queryClient.invalidateQueries({
        queryKey: ["referendum-votes", chain.id, referendumIndex],
      })
      void queryClient.invalidateQueries({
        queryKey: ["my-votes", chain.id, activeAddress, trackId, referendumIndex],
      })
      void queryClient.invalidateQueries({
        queryKey: ["account-locks", chain.id, activeAddress],
      })
      if (signRemove.isWalletConnect) return
      toast.success("Vote removed", {
        id: "remove-vote-tx",
        description: subscanExtrinsicUrl(chain, txHash),
        action: {
          label: "Subscan",
          onClick: () =>
            window.open(subscanExtrinsicUrl(chain, txHash), "_blank"),
        },
      })
    },
  })

  const handleRemoveVote = async (target: VoteCurrency) => {
    if (effectiveTrackId == null) {
      toast.error("Can't remove vote", {
        description: "Track id isn't loaded yet. Try again in a moment.",
      })
      return
    }
    removingCurrencyRef.current = target
    setRemovingCurrency(target)
    signRemove.open()
    try {
      await removeTx.submit()
    } catch {
      // status callback already toasted
    } finally {
      setRemovingCurrency(null)
    }
  }

  const handleSubmit = async () => {
    setAmountError(null)
    if (!vote) return
    if (parsedAmount == null || parsedAmount <= 0n) {
      setAmountError(`Enter a positive ${chain.ticker} amount.`)
      return
    }
    if (exceedsBalance) {
      setAmountError("Amount exceeds your balance.")
      return
    }
    sign.open()
    try {
      await tx.submit()
    } catch {
      // Status callback already surfaced the toast.
    }
  }

  // Flips to true the moment the block author includes the tx - matches
  // the SignRequestModal's `successAt: "in-block"` so the celebration
  // card under the modal lands at the same time the modal shows the
  // green check.
  const finalized =
    tx.status.kind === "in-block" || tx.status.kind === "finalized"

  return (
    <>
      <div className="rounded-2xl bg-card border border-border overflow-hidden sticky top-20">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground text-sm">
            {myVotes.length > 0
              ? isOngoing
                ? "Change your vote"
                : "Your vote"
              : "Cast your vote"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isOngoing
              ? myVotes.length > 0
                ? `Each source (ENJ + sENJ pools) votes independently. Submit replaces your vote for the selected source.`
                : `Voting on referendum #${referendumIndex}`
              : "Voting has closed"}
          </p>
        </div>

        {/* Render the stack whenever the user has votes - including on
            terminal referenda, where the only remaining action is removing
            the vote to free its conviction lock. */}
        {myVotes.length > 0 && !finalized && (
          <CurrentVotesStack
            votes={myVotes}
            chain={chain}
            voteLockingPeriod={voteLockingPeriod}
            removing={removeTx.isSubmitting}
            removeStatus={removeTx.status.kind}
            canRemove={effectiveTrackId != null && !tx.isSubmitting}
            editable={isOngoing}
            removingCurrency={removingCurrency}
            onRemove={handleRemoveVote}
          />
        )}

        <div className="p-5 space-y-4">
          {finalized ? (
            <div className="py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Vote recorded on chain</p>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className={vote === "aye" ? "text-green-400" : "text-red-400"}>
                    {vote === "aye" ? "Aye" : "Nay"}
                  </span>{" "}
                  at {multiplier}x conviction.
                </p>
              </div>
              <button
                onClick={tx.reset}
                className="text-xs text-primary hover:text-primary/80"
              >
                Cast another vote
              </button>
            </div>
          ) : !isOngoing ? (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground">
                Voting has ended for this referendum.
              </p>
            </div>
          ) : !connected ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Connect your wallet to vote. You can browse without connecting.
              </p>
              <button
                onClick={() => setWalletOpen(true)}
                className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all duration-200 glow-purple-sm"
              >
                Connect Wallet
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {stakedHoldings.length > 0 ? (
                <VoteCurrencySelect
                  chain={chain}
                  freeEnjBalance={balanceQuery.data ?? null}
                  stakedHoldings={stakedHoldings}
                  selected={currency}
                  onChange={(next) => {
                    setCurrency(next)
                    setAmountError(null)
                  }}
                  disabled={tx.isSubmitting}
                />
              ) : (
                <div className="rounded-xl bg-surface-2 px-3.5 py-3 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Free balance</span>
                  <span className="font-semibold text-foreground font-mono">
                    {balanceQuery.isPending
                      ? "…"
                      : balanceQuery.data != null
                        ? formatTokenAmount(balanceQuery.data, chain)
                        : `0 ${chain.ticker}`}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setVote("aye")}
                  disabled={tx.isSubmitting}
                  className={cn(
                    "flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-medium transition-all duration-200 disabled:opacity-50",
                    vote === "aye"
                      ? "border-green-500/50 bg-green-500/10 text-green-400"
                      : "border-border text-muted-foreground hover:border-green-500/30 hover:text-green-400 hover:bg-green-500/5",
                  )}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Aye
                </button>
                <button
                  onClick={() => setVote("nay")}
                  disabled={tx.isSubmitting}
                  className={cn(
                    "flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-medium transition-all duration-200 disabled:opacity-50",
                    vote === "nay"
                      ? "border-red-500/50 bg-red-500/10 text-red-400"
                      : "border-border text-muted-foreground hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/5",
                  )}
                >
                  <XCircle className="w-4 h-4" />
                  Nay
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="vote-amount">
                  Amount ({currency.kind === "Enj" ? chain.ticker : "sENJ"})
                </label>
                <input
                  id="vote-amount"
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value)
                    setAmountError(null)
                  }}
                  disabled={tx.isSubmitting}
                  className={cn(
                    "w-full px-3.5 py-2.5 rounded-xl bg-surface-1 border text-sm text-foreground font-mono focus:outline-none focus:ring-1 transition-all",
                    amountError || exceedsBalance
                      ? "border-destructive/50 focus:border-destructive focus:ring-destructive/30"
                      : "border-border focus:border-primary/50 focus:ring-primary/20",
                  )}
                />
                {amountError ? (
                  <p className="text-[11px] text-destructive">{amountError}</p>
                ) : exceedsBalance ? (
                  <p className="text-[11px] text-destructive">
                    Not enough balance
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => setShowConviction((s) => !s)}
                  disabled={tx.isSubmitting}
                  className="w-full flex items-center justify-between px-3.5 py-3 text-sm hover:bg-surface-1 transition-colors disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Lock className="w-3.5 h-3.5" />
                    Conviction: {lockLabel}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-primary font-medium">{multiplier}x</span>
                    {showConviction ? (
                      <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </span>
                </button>

                {showConviction && (
                  <div className="border-t border-border divide-y divide-border">
                    {CONVICTIONS.map((c) => {
                      const label =
                        c === "None"
                          ? "No lock"
                          : formatBlockDuration(convictionLockBlocks(c, voteLockingPeriod))
                      return (
                        <button
                          key={c}
                          onClick={() => {
                            setConviction(c)
                            setShowConviction(false)
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition-colors",
                            conviction === c
                              ? "bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:bg-surface-1 hover:text-foreground",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <Lock className="w-3 h-3" />
                            {label}
                          </span>
                          <span className="font-semibold text-primary">
                            {CONVICTION_MULTIPLIER[c]}x
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-primary/5 border border-purple-border px-3.5 py-3 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  Voting power
                </span>
                <span className="font-semibold text-primary font-mono">
                  ≈{" "}
                  {votingPower.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  {currency.kind === "Enj" ? chain.ticker : "sENJ"}
                </span>
              </div>

              <button
                onClick={handleSubmit}
                disabled={
                  !vote ||
                  tx.isSubmitting ||
                  parsedAmount == null ||
                  parsedAmount <= 0n ||
                  exceedsBalance
                }
                className={cn(
                  "w-full px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                  vote && !tx.isSubmitting && !exceedsBalance
                    ? "bg-primary text-primary-foreground hover:bg-purple-dim glow-purple-sm"
                    : "bg-surface-2 text-muted-foreground cursor-not-allowed",
                )}
              >
                {tx.isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />
                    {tx.status.kind === "signing"
                      ? "Awaiting signature…"
                      : tx.status.kind === "broadcast"
                        ? "Broadcasting…"
                        : tx.status.kind === "in-block"
                          ? "In block…"
                          : "Submitting…"}
                  </span>
                ) : exceedsBalance ? (
                  "Not enough balance"
                ) : vote ? (
                  selectedVote
                    ? `Change to ${vote === "aye" ? "Aye" : "Nay"}`
                    : `Vote ${vote === "aye" ? "Aye" : "Nay"}`
                ) : (
                  "Select a vote"
                )}
              </button>

              <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                {conviction === "None"
                  ? "No lock - vote with 0.1x weight"
                  : `Lock for ${lockLabel} after the referendum ends`}
              </p>
            </div>
          )}
        </div>
      </div>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the vote in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Vote recorded on chain"
        successBody="Thanks for shaping the future of Enjin."
        successAt="in-block"
        autoDismiss={false}
        onClose={sign.close}
        onRetry={() => {
          tx.reset()
          void tx.submit()
        }}
      />
      <SignRequestModal
        open={signRemove.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve removing your vote in your wallet"
        status={removeTx.status}
        deepLinkUrl={signRemove.deepLinkUrl}
        explorerUrl={
          removeTx.status.kind === "in-block" ||
          removeTx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, removeTx.status.txHash)
            : null
        }
        autoDismiss={false}
        successTitle="Vote removed"
        successBody="Your vote is no longer counted on this referendum."
        successAt="in-block"
        onClose={signRemove.close}
        onRetry={() => {
          removeTx.reset()
          void removeTx.submit()
        }}
      />
    </>
  )
}


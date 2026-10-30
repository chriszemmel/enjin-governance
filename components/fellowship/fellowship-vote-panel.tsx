"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Lock, ShieldCheck, XCircle } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  buildFellowshipVote,
  rankName,
  rankNumeral,
  trackMinRank,
  voteWeight,
} from "@/lib/governance/fellowship"
import { useMyFellowshipVote, useMyRank } from "@/lib/query/hooks/use-fellowship"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { RankBadge } from "./rank-badge"

const BUTTON =
  "flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-medium transition-all duration-200 disabled:opacity-50"

/**
 * Voting on a fellowship referendum: members ranked high enough for the
 * track vote Aye or Nay, weighted by rank. No amount, no conviction, no
 * lock; the vote can change while the poll is open.
 */
export function FellowshipVotePanel({
  index,
  trackId,
  isOngoing,
}: {
  index: number
  trackId: number | null
  isOngoing: boolean
}) {
  const chain = useActiveChain()
  const queryClient = useQueryClient()
  const { status: walletStatus, activeAddress, session } = useWallet()
  const walletMeta = walletDisplayFor(session ?? null)
  const connected = walletStatus === "connected" && !!activeAddress
  const [walletOpen, setWalletOpen] = useState(false)
  const [vote, setVote] = useState<"aye" | "nay" | null>(null)
  const sign = useSignFlow()

  const { rank, isPending: rankPending } = useMyRank(activeAddress)
  const myVoteQuery = useMyFellowshipVote(index, activeAddress)
  const myVote = myVoteQuery.data ?? null
  const minRank = trackMinRank(trackId ?? 0)
  const eligible = rank != null && rank >= minRank
  const weight = rank != null ? voteWeight(rank, minRank) : 0

  // Start from the member's vote on chain, if any.
  // A vote on chain shows as its own row; the buttons then pick a change.
  useEffect(() => {
    setVote(null)
  }, [myVote?.aye])

  const tx = useExtrinsic({
    build: (api) => buildFellowshipVote(api, index, vote === "aye"),
    onStatus(status) {
      if (sign.isWalletConnect && status.kind !== "finalized") return
      if (status.kind === "broadcast") {
        toast.loading("Broadcasting vote…", { id: "fellowship-vote" })
      } else if (status.kind === "error") {
        toast.error("Vote failed", { id: "fellowship-vote", description: status.message })
      } else if (status.kind === "finalized") {
        toast.success("Vote finalised on chain", {
          id: "fellowship-vote",
          description: subscanExtrinsicUrl(chain, status.txHash),
        })
      }
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ["fellowship", chain.id] })
    },
  })

  const done = tx.status.kind === "in-block" || tx.status.kind === "finalized"
  // Re-sending the vote already on chain would only cost a fee.
  const unchanged = !!myVote && vote != null && myVote.aye === (vote === "aye")
  const label = vote === "aye" ? "Aye" : "Nay"

  return (
    <>
      <div className="rounded-2xl bg-card border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground text-sm">
            {myVote && isOngoing ? "Change your vote" : "Cast your vote"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isOngoing ? `Fellowship vote on F#${index}` : "Voting has closed"}
          </p>
        </div>
        <div className="p-5 space-y-3">
          {!isOngoing ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Voting has ended for this referendum.
            </p>
          ) : !connected ? (
            <>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Members of rank {rankNumeral(minRank)} or higher vote on this track. Anyone can
                follow the tally and comment.
              </p>
              <button
                onClick={() => setWalletOpen(true)}
                className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all duration-200 glow-purple-sm"
              >
                Connect Wallet
              </button>
            </>
          ) : done ? (
            <div className="py-4 text-center space-y-2">
              <CheckCircle2 className="w-6 h-6 text-green-500 mx-auto" />
              <p className="font-semibold text-foreground text-sm">Vote recorded on chain</p>
              <p className="text-xs text-muted-foreground">
                {label}, counting {weight}.
              </p>
              <button onClick={tx.reset} className="text-xs text-primary hover:text-primary/80">
                Change it
              </button>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Your rank</span>
                {rankPending ? (
                  <span className="text-muted-foreground">…</span>
                ) : rank != null ? (
                  <RankBadge rank={rank} />
                ) : (
                  <span className="text-muted-foreground">Not a member</span>
                )}
              </div>
              {myVote && (
                <div
                  className={cn(
                    "rounded-xl border px-3.5 py-2.5 flex items-center justify-between text-xs",
                    myVote.aye
                      ? "border-green-500/40 bg-green-500/10 text-green-800 dark:text-green-400"
                      : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
                  )}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    {myVote.aye ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    {myVote.aye ? "Aye" : "Nay"}
                  </span>
                  <span className="font-mono">{myVote.weight} votes</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setVote("aye")}
                  disabled={!eligible || tx.isSubmitting}
                  className={cn(
                    BUTTON,
                    vote === "aye"
                      ? "border-green-500/50 bg-green-500/10 text-green-800 dark:text-green-400"
                      : "border-border text-muted-foreground hover:border-green-500/30 hover:text-green-800 dark:hover:text-green-400 hover:bg-green-500/5",
                  )}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Aye
                </button>
                <button
                  onClick={() => setVote("nay")}
                  disabled={!eligible || tx.isSubmitting}
                  className={cn(
                    BUTTON,
                    vote === "nay"
                      ? "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
                      : "border-border text-muted-foreground hover:border-red-500/30 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/5",
                  )}
                >
                  <XCircle className="w-4 h-4" />
                  Nay
                </button>
              </div>
              {!eligible ? (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5 leading-relaxed pt-1">
                  <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  {rank == null
                    ? `Only members of rank ${rankNumeral(minRank)} (${rankName(minRank)}) or higher vote on this track.`
                    : `This track needs rank ${rankNumeral(minRank)} (${rankName(minRank)}).`}
                </p>
              ) : (
                <>
                  <div className="rounded-xl bg-primary/5 border border-purple-border px-3.5 py-3 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                      Your vote counts
                    </span>
                    <span className="font-semibold text-primary font-mono">{weight}</span>
                  </div>
                  <button
                    onClick={async () => {
                      if (!vote) return
                      sign.open()
                      try {
                        await tx.submit()
                      } catch {
                        // The status callback already showed it.
                      }
                    }}
                    disabled={!eligible || !vote || unchanged || tx.isSubmitting}
                    className={cn(
                      "w-full px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                      eligible && vote && !unchanged && !tx.isSubmitting
                        ? "bg-primary text-primary-foreground hover:bg-purple-dim glow-purple-sm"
                        : "bg-surface-2 text-muted-foreground cursor-not-allowed",
                    )}
                  >
                    {tx.isSubmitting
                      ? tx.status.kind === "signing"
                        ? "Awaiting signature…"
                        : "Submitting…"
                      : !vote
                        ? myVote
                          ? `Change to ${myVote.aye ? "Nay" : "Aye"}`
                          : "Select a vote"
                        : unchanged
                          ? `You voted ${label}`
                          : myVote
                            ? `Change to ${label}`
                            : `Vote ${label}`}
                  </button>
                  <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                    No lock and no conviction - change it while the poll is open
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the fellowship vote in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Vote recorded on chain"
        successBody="The tally updates with the next block."
        successAt="in-block"
        autoDismiss={false}
        onClose={sign.close}
        onRetry={() => {
          tx.reset()
          void tx.submit()
        }}
      />
    </>
  )
}

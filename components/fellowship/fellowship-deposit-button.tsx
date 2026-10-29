"use client"

import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { formatTokenAmount } from "@/lib/chain/format"
import { useActiveChain } from "@/lib/chain/use-chain"
import { buildFellowshipPlaceDeposit } from "@/lib/governance/fellowship"
import type { Track } from "@/lib/governance/types"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { useWallet } from "@/lib/wallet/use-wallet"

/**
 * A fellowship referendum can't start deciding until its track's decision
 * deposit is placed. Anyone may place it; it comes back once the
 * referendum is decided.
 */
export function FellowshipDepositButton({ index, track }: { index: number; track: Track | null }) {
  const chain = useActiveChain()
  const queryClient = useQueryClient()
  const { status, session } = useWallet()
  const walletMeta = walletDisplayFor(session ?? null)
  const sign = useSignFlow()
  const tx = useExtrinsic({
    build: (api) => buildFellowshipPlaceDeposit(api, index),
    onStatus(s) {
      if (s.kind === "error") toast.error("Could not place the deposit", { description: s.message })
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ["fellowship", chain.id] })
    },
  })
  const amount = track
    ? formatTokenAmount(track.decisionDeposit, chain, { maxFractionDigits: 0 })
    : null
  return (
    <div className="rounded-2xl bg-amber-500/5 border border-amber-500/30 p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Decision deposit not yet placed</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          F#{index} can&apos;t enter the deciding phase until the track&apos;s decision deposit
          {amount ? ` of ${amount}` : ""} is reserved. Anyone can place it; it is refunded once the
          referendum is decided.
        </p>
      </div>
      <button
        onClick={async () => {
          sign.open()
          try {
            await tx.submit()
          } catch {
            // Shown by the status callback.
          }
        }}
        disabled={status !== "connected" || tx.isSubmitting}
        className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all disabled:opacity-50"
      >
        {status !== "connected"
          ? "Connect a wallet to place it"
          : tx.isSubmitting
            ? "Submitting…"
            : `Place decision deposit${amount ? ` (${amount})` : ""}`}
      </button>
      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the decision deposit in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Decision deposit placed"
        successBody={`F#${index} can now start deciding.`}
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

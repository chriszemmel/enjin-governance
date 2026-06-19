"use client"

import { useState } from "react"
import { Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { subscanExtrinsicUrl, type ChainConfig } from "@/lib/chain/chains"
import {
  buildRefundDecisionDeposit,
  buildRefundSubmissionDeposit,
} from "@/lib/governance/referenda"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { WalletModal } from "@/components/wallet/wallet-modal"

type Props = {
  referendumIndex: number
  kind: "decision" | "submission"
  chain: ChainConfig
}

/**
 * Refund a submission or decision deposit on a referendum that has
 * reached a terminal state (Approved / Rejected / TimedOut / Cancelled).
 * Anyone can submit the call - the deposit returns to whichever address
 * originally placed it, not the caller. So we surface this button to
 * every visitor.
 *
 * Self-contained (own sign modal) for stable single-card use, e.g. the
 * proposal detail page. The account page's deposits list uses its own
 * panel-level flow instead, because list rows unmount on refetch.
 */
export function RefundDepositButton({ referendumIndex, kind, chain }: Props) {
  const { status: walletStatus, session: walletSession } = useWallet()
  const [walletOpen, setWalletOpen] = useState(false)
  const isConnected = walletStatus === "connected"
  const sign = useSignFlow()
  const walletMeta = walletDisplayFor(walletSession ?? null)

  const tx = useExtrinsic({
    build: (api) =>
      kind === "decision"
        ? buildRefundDecisionDeposit(api, referendumIndex)
        : buildRefundSubmissionDeposit(api, referendumIndex),
    onStatus(status) {
      const id = `refund-${kind}-${referendumIndex}`
      if (status.kind === "finalized") {
        toast.success(
          kind === "decision"
            ? "Decision deposit refund finalised on chain"
            : "Submission deposit refund finalised on chain",
          {
            id,
            description: `Returned to the original placer on ${chain.shortName}.`,
          },
        )
        return
      }
      if (sign.isWalletConnect) {
        // SignRequestModal renders the full lifecycle.
        return
      }
      if (status.kind === "signing") {
        toast.dismiss(id)
        toast.loading("Waiting for wallet signature…", { id, description: "" })
      } else if (status.kind === "broadcast") {
        toast.dismiss(id)
        toast.loading("Broadcasting…", { id, description: "" })
      } else if (status.kind === "error") {
        toast.dismiss(id)
        toast.error("Refund failed", { id, description: status.message })
      }
    },
    onSuccess() {
      if (sign.isWalletConnect) return
      const id = `refund-${kind}-${referendumIndex}`
      toast.dismiss(id)
      toast.success(
        kind === "decision"
          ? "Decision deposit refunded"
          : "Submission deposit refunded",
        {
          id,
          description: `Returned to the original placer on ${chain.shortName}.`,
        },
      )
    },
  })

  const handleClick = () => {
    if (!isConnected) {
      setWalletOpen(true)
      return
    }
    sign.open()
    void tx.submit()
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={tx.isSubmitting}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-purple-border transition-all disabled:opacity-50"
        title="Anyone can submit this; the deposit returns to its original placer."
      >
        {tx.isSubmitting ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Undo2 className="w-3 h-3" />
        )}
        Refund
      </button>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle={
          kind === "decision"
            ? "Approve the decision-deposit refund in your wallet"
            : "Approve the submission-deposit refund in your wallet"
        }
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle={
          kind === "decision"
            ? "Decision deposit refunded"
            : "Submission deposit refunded"
        }
        successBody={`Returned to the original placer on ${chain.shortName}.`}
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

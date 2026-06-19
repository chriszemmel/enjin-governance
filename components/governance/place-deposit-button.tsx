"use client"

import { useState } from "react"
import { Coins, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { subscanExtrinsicUrl, type ChainConfig } from "@/lib/chain/chains"
import { formatTokenAmount } from "@/lib/chain/format"
import { buildPlaceDecisionDeposit } from "@/lib/governance/referenda"
import { findTrack, findTrackByName } from "@/lib/governance/tracks"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { WalletModal } from "@/components/wallet/wallet-modal"

type Props = {
  referendumIndex: number
  trackId?: number | null
  trackName?: string | null
  chain: ChainConfig
}

/**
 * One-click action to place the decision deposit on a referendum that
 * needs one. Reads the per-track required amount from chain consts,
 * shows it on the button, and submits `referenda.placeDecisionDeposit`
 * via the connected wallet.
 *
 * Anyone can place the deposit - not just the proposer - so this is
 * surfaced to every visitor when the slot is empty.
 */
export function PlaceDepositButton(p: Props) {
  const { status: walletStatus, session: walletSession } = useWallet()
  const walletMeta = walletDisplayFor(walletSession ?? null)
  const [walletOpen, setWalletOpen] = useState(false)
  const isConnected = walletStatus === "connected"
  const tracksQuery = useTracks(p.chain)
  const sign = useSignFlow()

  const track =
    tracksQuery.data &&
    (p.trackId != null
      ? findTrack(tracksQuery.data, p.trackId)
      : p.trackName
        ? findTrackByName(tracksQuery.data, p.trackName)
        : null)

  const tx = useExtrinsic({
    build: (api) => buildPlaceDecisionDeposit(api, p.referendumIndex),
    onStatus(status) {
      if (status.kind === "finalized") {
        toast.success("Decision deposit finalised on chain", {
          id: "place-deposit",
          description: `Referendum #${p.referendumIndex} is locked in for the deciding stage.`,
        })
        return
      }
      if (sign.isWalletConnect) {
        // SignRequestModal renders the full lifecycle.
        return
      }
      if (status.kind === "signing") {
        toast.dismiss("place-deposit")
        toast.loading("Waiting for wallet signature…", {
          id: "place-deposit",
          description: "",
        })
      } else if (status.kind === "broadcast") {
        toast.dismiss("place-deposit")
        toast.loading("Broadcasting…", {
          id: "place-deposit",
          description: "",
        })
      } else if (status.kind === "error") {
        toast.dismiss("place-deposit")
        toast.error("Could not place deposit", {
          id: "place-deposit",
          description: status.message,
        })
      }
    },
    onSuccess() {
      if (sign.isWalletConnect) return
      toast.dismiss("place-deposit")
      toast.success("Decision deposit placed", {
        id: "place-deposit",
        description: `Referendum #${p.referendumIndex} is ready to enter deciding.`,
      })
    },
  })

  const amountLabel = track
    ? formatTokenAmount(track.decisionDeposit, p.chain)
    : null

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
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        title={
          amountLabel
            ? `Reserve ${amountLabel} as the decision deposit for this referendum`
            : "Place the decision deposit so this referendum can enter deciding"
        }
      >
        {tx.isSubmitting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Coins className="w-3.5 h-3.5" />
        )}
        {isConnected ? "Place" : "Connect to place"}
        {amountLabel && (
          <span className="text-[10px] font-mono opacity-80">
            {amountLabel}
          </span>
        )}
      </button>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the decision deposit in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(p.chain, tx.status.txHash)
            : null
        }
        successTitle="Decision deposit placed"
        successBody={`Referendum #${p.referendumIndex} is ready to enter deciding.`}
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

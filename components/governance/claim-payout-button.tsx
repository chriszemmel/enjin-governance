"use client"

import { useState } from "react"
import { Check, Copy, Loader2 } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { subscanExtrinsicUrl, type ChainConfig } from "@/lib/chain/chains"
import { formatTokenAmount } from "@/lib/chain/format"
import { encodeForChain, encodePublicKeyForChain } from "@/lib/chain/ss58"
import { buildClaimPayout } from "@/lib/governance/payout"
import { useApi } from "@/lib/query/hooks/use-api"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { PolkadotIdenticon } from "@/components/profile/identicon"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AddressLink } from "./address-link"

type Props = {
  /** `treasury.spends` index of the spend to pay out. */
  spendIndex: number
  amount: bigint
  /** Beneficiary public key, hex (or an SS58 address). */
  beneficiary: string
  /** When the window to claim ends, as the card words it ("≈ Dec 29"); null when unknown. */
  expires: string | null
  chain: ChainConfig
}

/**
 * Pay out a `treasury.spend` the referendum approved. Anyone can send
 * `treasury.payout`; the funds go to the beneficiary, not to the caller, who
 * only pays the fee. A wallet that isn't connected is asked for first (the
 * wallet picker, as the Refund button does), then a confirmation says where
 * the money goes before anything is signed.
 */
export function ClaimPayoutButton({ spendIndex, amount, beneficiary, expires, chain }: Props) {
  const { status: walletStatus, session: walletSession, activeAddress } = useWallet()
  const [walletOpen, setWalletOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isConnected = walletStatus === "connected"
  const sign = useSignFlow()
  const walletMeta = walletDisplayFor(walletSession ?? null)
  const queryClient = useQueryClient()
  const toastId = `claim-payout-${spendIndex}`

  const ss58 = toSs58(beneficiary, chain)
  const isYou = isSameAccount(activeAddress, ss58, chain)
  const amountText = formatTokenAmount(amount, chain, { maxFractionDigits: 2 })

  // What the claim costs the caller, from the node, once the confirmation is open.
  const api = useApi().data
  const feeQuery = useQuery<bigint>({
    queryKey: ["claim-payout-fee", chain.id, spendIndex, activeAddress],
    queryFn: async () => {
      if (!api || !activeAddress) throw new Error("not ready")
      const info = await buildClaimPayout(api, spendIndex).paymentInfo(activeAddress)
      return info.partialFee.toBigInt()
    },
    enabled: confirmOpen && api != null && !!activeAddress,
    staleTime: 60_000,
    retry: 1,
  })

  const tx = useExtrinsic({
    build: (api) => buildClaimPayout(api, spendIndex),
    onStatus(status) {
      if (status.kind === "finalized") return
      if (sign.isWalletConnect) return
      if (status.kind === "signing") {
        toast.dismiss(toastId)
        toast.loading("Waiting for wallet signature…", { id: toastId, description: "" })
      } else if (status.kind === "broadcast") {
        toast.dismiss(toastId)
        toast.loading("Broadcasting…", { id: toastId, description: "" })
      } else if (status.kind === "error") {
        toast.dismiss(toastId)
        toast.error("Claim failed", { id: toastId, description: status.message })
      }
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ["spend-claim"] })
      if (sign.isWalletConnect) return
      toast.dismiss(toastId)
      toast.success("Payout claimed", {
        id: toastId,
        description: `Paid to the beneficiary on ${chain.shortName}.`,
      })
    },
  })

  const handleClick = () => {
    if (!isConnected) {
      setWalletOpen(true)
      return
    }
    setConfirmOpen(true)
  }

  const handleConfirm = () => {
    setConfirmOpen(false)
    sign.open()
    void tx.submit()
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={tx.isSubmitting}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {tx.isSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
        Claim payout
      </button>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="w-[calc(100%-3rem)] max-w-[calc(100%-3rem)] sm:max-w-md p-6 gap-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle>Confirm payout</DialogTitle>
            <DialogDescription>Pays the approved spend to the beneficiary.</DialogDescription>
          </DialogHeader>
          <dl className="text-sm divide-y divide-border">
            <Row label="Amount">
              <span className="font-semibold text-foreground">{amountText}</span>
            </Row>
            <Row label="To">
              <BeneficiaryChip address={ss58} value={beneficiary} chain={chain} isYou={isYou} />
            </Row>
            <Row label="Call">
              <span className="font-mono text-xs font-semibold text-foreground">
                treasury.payout({spendIndex})
              </span>
            </Row>
            {feeQuery.data != null && (
              <Row label="Fee, paid by you">
                <span className="font-semibold text-foreground">
                  {formatFee(feeQuery.data, chain)}
                </span>
              </Row>
            )}
          </dl>
          <div className="text-center text-[13px] leading-snug">
            <p className="text-muted-foreground">
              {isYou ? "The funds go to you." : "The funds go to the beneficiary, not to you."}
            </p>
            {expires && <p className="mt-1 font-semibold text-foreground">Expires {expires}</p>}
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleConfirm}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Claim payout
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="w-full rounded-xl border border-border px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the payout in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Payout claimed"
        successBody={`${amountText} were paid to the beneficiary on ${chain.shortName}.`}
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

/** Identicon, the short address as a Subscan link, and a button to copy it in full. */
function BeneficiaryChip({
  address,
  value,
  chain,
  isYou,
}: {
  address: string | null
  value: string
  chain: ChainConfig
  isYou: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address ?? value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked: nothing to do
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      {address && <PolkadotIdenticon address={address} size={20} />}
      {isYou && <span className="text-sm font-semibold text-foreground">You ·</span>}
      <AddressLink
        value={value}
        chain={chain}
        className="text-xs font-semibold underline underline-offset-2"
      />
      <button
        type="button"
        onClick={copy}
        aria-label="Copy address"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      </button>
    </span>
  )
}

/**
 * The fee as the confirmation words it: "≈ 0.0058 ENJ", rounded up to four
 * decimals so an estimate never understates the cost, and "< 0.0001 ENJ" for a
 * fee too small to show.
 */
export function formatFee(fee: bigint, chain: ChainConfig): string {
  const unit = 10n ** BigInt(chain.decimals - 4)
  if (fee < unit) return `< 0.0001 ${chain.ticker}`
  const rounded = ((fee + unit - 1n) / unit) * unit
  return `≈ ${formatTokenAmount(rounded, chain, { maxFractionDigits: 4 })}`
}

function toSs58(value: string, chain: ChainConfig): string | null {
  try {
    return /^0x[0-9a-fA-F]{64}$/.test(value)
      ? encodePublicKeyForChain(value, chain.id)
      : encodeForChain(value, chain.id)
  } catch {
    return null
  }
}

function isSameAccount(active: string | null, ss58: string | null, chain: ChainConfig): boolean {
  if (!active || !ss58) return false
  try {
    return encodeForChain(active, chain.id) === ss58
  } catch {
    return false
  }
}

"use client"

import { useMemo, useState } from "react"
import { Heart, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { WalletModal } from "@/components/wallet/wallet-modal"
import {
  type ChainConfig,
  subscanExtrinsicUrl,
} from "@/lib/chain/chains"
import {
  formatTokenAmount,
  parseTokenAmount,
} from "@/lib/chain/format"
import { shortenAddress } from "@/lib/chain/ss58"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useBalance } from "@/lib/query/hooks/use-balance"
import { useTokenPrice } from "@/lib/query/hooks/use-token-price"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { cn } from "@/lib/utils"

type Props = {
  chain: ChainConfig
}

/**
 * Lets any connected wallet send a `balances.transferKeepAlive` to the
 * treasury account. Pure gesture - the treasury is the same pallet
 * account every governance flow already references; it just can't
 * spend if the balance is empty. KeepAlive variant so a generous user
 * doesn't accidentally reap their own account by donating their full
 * free balance below the existential deposit.
 */
export function TopUpTreasuryButton({ chain }: Props) {
  const { status: walletStatus, session: walletSession, activeAddress } =
    useWallet()
  const isConnected = walletStatus === "connected"
  const walletMeta = walletDisplayFor(walletSession ?? null)
  const sign = useSignFlow()

  const [walletOpen, setWalletOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [amount, setAmount] = useState("")

  const balanceQuery = useBalance(activeAddress, chain)
  const priceQuery = useTokenPrice()

  const parsed = useMemo(() => {
    if (!amount.trim()) return { value: null as bigint | null, error: null as string | null }
    try {
      const v = parseTokenAmount(amount, chain)
      if (v === 0n) return { value: null, error: "Amount must be greater than zero." }
      return { value: v, error: null }
    } catch {
      return { value: null, error: "Enter a number, e.g. 10 or 0.5." }
    }
  }, [amount, chain])

  const free = balanceQuery.data ?? null
  const overBalance =
    parsed.value != null && free != null && parsed.value > free

  const usdApprox = (() => {
    if (parsed.value == null || priceQuery.data == null) return null
    // No precision loss in display: convert via string then to number.
    const tokens = Number(
      formatTokenAmount(parsed.value, chain, {
        maxFractionDigits: 6,
        withTicker: false,
      }).replace(/,/g, ""),
    )
    if (!Number.isFinite(tokens)) return null
    return tokens * priceQuery.data
  })()

  const tx = useExtrinsic({
    build: (api) => {
      if (parsed.value == null) throw new Error("Enter a valid amount.")
      return api.tx.balances.transferKeepAlive(
        chain.treasuryAddress,
        parsed.value,
      )
    },
    onStatus(status) {
      if (status.kind === "finalized") {
        toast.success("Treasury contribution finalised on chain", {
          id: "top-up-treasury",
          description: subscanExtrinsicUrl(chain, status.txHash),
          action: {
            label: "Subscan",
            onClick: () =>
              window.open(subscanExtrinsicUrl(chain, status.txHash), "_blank"),
          },
        })
        return
      }
      if (sign.isWalletConnect) return
      if (status.kind === "signing") {
        toast.loading("Waiting for wallet signature…", {
          id: "top-up-treasury",
          description: "",
        })
      } else if (status.kind === "broadcast") {
        toast.loading("Broadcasting…", {
          id: "top-up-treasury",
          description: "",
        })
      } else if (status.kind === "error") {
        toast.error("Could not send", {
          id: "top-up-treasury",
          description: status.message,
        })
      }
    },
    onSuccess({ txHash }) {
      // Clear the amount so reopening the dialog later doesn't show the
      // last-sent value as a stale default.
      setAmount("")
      if (sign.isWalletConnect) return
      toast.success("Contribution sent", {
        id: "top-up-treasury",
        description: subscanExtrinsicUrl(chain, txHash),
        action: {
          label: "Subscan",
          onClick: () =>
            window.open(subscanExtrinsicUrl(chain, txHash), "_blank"),
        },
      })
    },
  })

  const onTriggerClick = () => {
    if (!isConnected) {
      setWalletOpen(true)
      return
    }
    setDialogOpen(true)
  }

  const onSend = () => {
    if (parsed.value == null || overBalance) return
    // Close the amount dialog BEFORE handing off to the SignRequestModal.
    // Radix's Dialog applies `pointer-events: none` to everything outside
    // its portal while it's open, and the SignRequestModal is rendered as
    // a sibling - leaving them both open would swallow taps on the modal's
    // "Open in Enjin Wallet" button on iOS.
    setDialogOpen(false)
    sign.open()
    void tx.submit()
  }

  const submitDisabled =
    parsed.value == null || overBalance || tx.isSubmitting

  const quickPicks = [10n, 100n, 1000n, 10000n] as const

  return (
    <>
      <button
        type="button"
        onClick={onTriggerClick}
        className="inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        title={`Top up the treasury - send ${chain.ticker} to the on-chain account`}
        aria-label="Top up the treasury"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100%-3rem)] max-w-[calc(100%-3rem)] sm:max-w-md p-5 sm:p-6 gap-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-primary" />
              Top up the treasury
            </DialogTitle>
            <DialogDescription className="text-left text-xs">
              A direct transfer to{" "}
              <span className="font-mono text-foreground">
                {shortenAddress(chain.treasuryAddress)}
              </span>{" "}
              on {chain.shortName}. The treasury account can only spend
              what it holds - every {chain.ticker} sent here is available
              to future approved referenda.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="top-up-amount"
                className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium"
              >
                Amount ({chain.ticker})
              </label>
              <input
                id="top-up-amount"
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={cn(
                  "mt-1 w-full px-3 py-2.5 rounded-xl bg-surface-1 border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 transition-all font-mono",
                  parsed.error || overBalance
                    ? "border-destructive/50 focus:border-destructive focus:ring-destructive/20"
                    : "border-border focus:border-primary/50 focus:ring-primary/20",
                )}
              />
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                <span className="text-muted-foreground">
                  {free != null
                    ? `Free balance ${formatTokenAmount(free, chain, { maxFractionDigits: 2 })}`
                    : isConnected
                      ? "Loading balance…"
                      : "Connect a wallet to send"}
                </span>
                {usdApprox != null && (
                  <span className="text-muted-foreground tabular-nums">
                    ≈ ${usdApprox.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              {(parsed.error || overBalance) && (
                <p className="mt-1 text-[11px] text-destructive">
                  {overBalance ? "Not enough free balance." : parsed.error}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {quickPicks.map((n) => (
                <button
                  key={n.toString()}
                  type="button"
                  onClick={() => setAmount(n.toString())}
                  className="px-2.5 py-1 rounded-md border border-border bg-surface-1 hover:bg-surface-2 text-[11px] font-mono text-foreground transition-colors"
                >
                  {n.toString()} {chain.ticker}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onSend}
              disabled={submitDisabled}
              className={cn(
                "w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                submitDisabled
                  ? "bg-surface-2 text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-purple-dim glow-purple-sm",
              )}
            >
              {tx.isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {tx.status.kind === "signing"
                    ? "Awaiting signature…"
                    : tx.status.kind === "broadcast"
                      ? "Broadcasting…"
                      : tx.status.kind === "in-block"
                        ? "In block…"
                        : "Submitting…"}
                </>
              ) : overBalance ? (
                "Not enough balance"
              ) : (
                <>
                  <Heart className="w-4 h-4" />
                  Send {parsed.value != null
                    ? formatTokenAmount(parsed.value, chain, { maxFractionDigits: 6 })
                    : `${chain.ticker}`}
                </>
              )}
            </button>
            <p className="text-[10px] text-muted-foreground text-center">
              Goes straight to the treasury system account. No fees skim,
              no intermediaries.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle={`Approve the transfer to the ${chain.shortName} treasury`}
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Sent to treasury"
        successBody={`Thanks - every ${chain.ticker} helps future referenda pay out.`}
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

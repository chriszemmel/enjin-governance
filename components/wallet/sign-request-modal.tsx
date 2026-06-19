"use client"

import { useEffect, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  RotateCw,
  X,
} from "lucide-react"
import { isMobileUserAgent } from "@/lib/wallet/deep-link"
import type { TxStatus } from "@/lib/query/hooks/use-tx"

interface SignRequestModalProps {
  open: boolean
  /**
   * Display name of the paired wallet - drives the modal's header,
   * body, and "Open in" CTA. Pass `walletDisplayFor(session).name`
   * from `lib/wallet/connector-registry` so peer-reported names
   * (Nova, Talisman Mobile, …) propagate through instead of a
   * hard-coded "Enjin Wallet".
   */
  walletName: string
  /** Local or remote icon URL for the paired wallet. */
  walletIcon: string
  /** Header subtitle used while the wallet is still signing (idle/signing). */
  subtitle: string
  /**
   * The full tx lifecycle. The modal renders different chrome per state:
   * idle/signing → spinner + "Open in <wallet>"; broadcast/in-block →
   * spinner + status line; finalized → green check + optional explorer
   * link; error → alert icon + message + Retry. Pass tx.status straight
   * through from useExtrinsic.
   */
  status: TxStatus
  /**
   * Deep link the "Open in <wallet>" button navigates to from inside a
   * fresh user-gesture frame. iOS Safari ignores deep links fired from
   * setTimeout / promise callbacks, so the wallet has to be popped via a
   * click handler.
   */
  deepLinkUrl: string
  /** Subscan-style URL for the finalised tx - rendered as "View on explorer". */
  explorerUrl?: string | null
  /** Header subtitle shown on the success step. */
  successTitle?: string
  /** Body copy under the green check on the success step. */
  successBody?: string
  /**
   * When to flip to the success card.
   * - "finalized" (default): wait for full GRANDPA confirmation. Use for
   *   flows whose `useExtrinsic` is also `resolveOn: "finalized"` (i.e.
   *   ones that persist on-chain event payloads to the DB).
   * - "in-block": flip the moment the block author has included the tx
   *   (~12s sooner on Enjin Relay). A small "Finalising on chain…" pill
   *   shows under the body until GRANDPA confirms; the user is free to
   *   close in the meantime.
   */
  successAt?: "in-block" | "finalized"
  /**
   * Auto-dismiss the success card ~2s after it appears (only for
   * `successAt: "in-block"`). Defaults to true. Set false for standalone
   * actions (remove vote, unlock) where there's no celebratory card beneath
   * the modal, so the confirmation sticks until the user taps Done.
   */
  autoDismiss?: boolean
  onClose: () => void
  /** Provide to render a Retry button when status.kind === "error". */
  onRetry?: () => void
}

/**
 * Single status surface for the whole tx lifecycle when signing through
 * WalletConnect (the user is over in Enjin Wallet on their phone, not in
 * the browser tab). One modal walks them from "approve in wallet" through
 * broadcast → in-block → finalised, so we don't need to layer toasts on
 * top.
 *
 * The deep link is fired from the button's own click handler
 * (window.location.href, same mechanism the pair flow's Open button
 * uses) - that's the only path iOS Safari reliably honours, because
 * the user-gesture token is alive at the moment of navigation. The WC
 * library's internal redirect is suppressed inside the WC signer to
 * keep this the single deep-link source.
 */
export function SignRequestModal({
  open,
  walletName,
  walletIcon,
  subtitle,
  status,
  deepLinkUrl,
  explorerUrl,
  successTitle,
  successBody,
  successAt = "finalized",
  autoDismiss = true,
  onClose,
  onRetry,
}: SignRequestModalProps) {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    setMobile(isMobileUserAgent())
  }, [])

  // Auto-dismiss for `successAt: "in-block"` flows. The cache
  // invalidation already ran in useExtrinsic's fireSuccess, so the page
  // beneath is up to date - the dialog just confirms the action and
  // quietly drops away. A short delay lets the green check register
  // without feeling abrupt. Finalisation continues in the background;
  // the caller's onStatus handler is responsible for the passive
  // "finalised on chain" toast after the modal is gone.
  const AUTO_DISMISS_MS = 2000
  const autoDismissable =
    autoDismiss &&
    successAt === "in-block" &&
    (status.kind === "in-block" || status.kind === "finalized")
  useEffect(() => {
    if (!open || !autoDismissable) return
    const timer = setTimeout(onClose, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [open, autoDismissable, onClose])

  if (!open) return null

  const isError = status.kind === "error"
  const isFinalized = status.kind === "finalized"
  const isBroadcast = status.kind === "broadcast"
  const isInBlock = status.kind === "in-block"

  // For `successAt: "in-block"` flows the user sees the green check the
  // moment the block author includes the tx. We still want the modal to
  // reflect ongoing GRANDPA confirmation; the residual pill below the
  // body covers that without holding the user in a spinner.
  const showSuccess = isFinalized || (successAt === "in-block" && isInBlock)
  const showFinalisingPill =
    showSuccess && successAt === "in-block" && !isFinalized

  const title = `Sign with ${walletName}`

  const headerSubtitle = isError
    ? "Sign request didn't go through"
    : showSuccess
      ? (successTitle ?? "Transaction confirmed on chain")
      : isBroadcast
        ? "Broadcasting your signed transaction…"
        : isInBlock
          ? "Included in a block - finalising on chain"
          : subtitle

  const bodyText = isError
    ? status.message
    : showSuccess
      ? (successBody ?? "You can close this modal.")
      : isBroadcast
        ? "Waiting for the network to include your transaction in a block."
        : isInBlock
          ? "A few seconds until the chain finalises this block."
          : `Approve the request in ${walletName}.`

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      <div
        className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {headerSubtitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pb-6 pt-2 flex flex-col items-center text-center gap-4">
          {isError ? (
            <div className="w-20 h-20 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center">
              <AlertCircle className="w-9 h-9 text-destructive" />
            </div>
          ) : showSuccess ? (
            <div className="w-20 h-20 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-green-400" />
            </div>
          ) : (
            <div className="relative w-20 h-20 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              {/* Wallet-supplied icon (local for the Enjin/WC connectors,
                  remote for peer wallets like Nova). Plain <img> so
                  arbitrary remote hosts don't need to be whitelisted in
                  next/image's domain allowlist. */}
              <img
                src={walletIcon}
                alt=""
                width={56}
                height={56}
                className="rounded-xl object-contain"
              />
            </div>
          )}

          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
            {bodyText}
          </p>

          {showFinalisingPill && (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                aria-hidden
                className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-pulse"
              />
              Finalising on chain…
            </p>
          )}

          {isError && onRetry ? (
            <button
              onClick={onRetry}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors glow-purple-sm"
            >
              <RotateCw className="w-4 h-4" />
              Retry
            </button>
          ) : showSuccess ? (
            <div className="w-full space-y-2">
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-purple-border text-sm font-medium text-foreground hover:bg-primary/10 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Subscan
                </a>
              )}
              <button
                onClick={onClose}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors glow-purple-sm"
              >
                Done
              </button>
            </div>
          ) : (
            mobile &&
            (status.kind === "idle" || status.kind === "signing") && (
              <a
                href={deepLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors glow-purple-sm"
              >
                <ExternalLink className="w-4 h-4" />
                Open in {walletName}
              </a>
            )
          )}
        </div>
      </div>
    </div>
  )
}

"use client"

import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { useExtrinsic } from "@/lib/query/hooks/use-tx"
import type { WizardStep } from "./create-ui"

type FooterProps = {
  step: WizardStep
  canStage: boolean
  missingReasons: string[]
  staging: boolean
  tx: ReturnType<typeof useExtrinsic>
  isConnected: boolean
  isWalletConnect: boolean
  peerRedirect: string | null
  onBack: () => void
  onStage: () => void
  onSign: () => void
  onRetry: () => void
  onView: () => void
}

export function WizardFooter(p: FooterProps) {
  const onSign = p.step === "submit"
  const txKind = p.tx.status.kind
  const signError = onSign && txKind === "error"
  const signWaiting = onSign && (txKind === "signing" || txKind === "broadcast")
  // Allow going back to Stage from Sign when the user can't / won't sign
  // (typically: error, or they want to disconnect-and-reconnect first).
  const canBack =
    p.step === "review" ||
    (p.step === "submit" && !p.tx.isSubmitting)

  const showMissing =
    p.step === "create" && !p.canStage && p.missingReasons.length > 0

  return (
    <div className="mt-8 space-y-3">
      {showMissing && (
        <div className="rounded-xl border border-border bg-surface-1 p-3.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
            Before you can stage this proposal
          </p>
          <ul className="space-y-1">
            {p.missingReasons.map((reason) => (
              <li
                key={reason}
                className="flex items-start gap-2 text-xs text-foreground/90"
              >
                <span className="mt-1 w-1 h-1 rounded-full bg-destructive shrink-0" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

    <div className="flex items-center justify-between gap-3 flex-wrap">
      <button
        type="button"
        onClick={p.onBack}
        disabled={!canBack || p.step === "create" || p.tx.status.kind === "finalized"}
        className="px-5 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-purple-border transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Back
      </button>

      <div className="flex items-center gap-3 flex-wrap ml-auto">
        {p.step === "create" && (
          <button
            type="button"
            onClick={p.onStage}
            disabled={!p.canStage}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
              p.canStage
                ? "bg-primary text-primary-foreground hover:bg-purple-dim glow-purple-sm"
                : "bg-surface-2 text-muted-foreground cursor-not-allowed",
            )}
          >
            {p.staging ? "Uploading…" : "Stage Proposal"}
            <ArrowRight className="w-4 h-4" />
          </button>
        )}

        {p.step === "review" && (
          <button
            type="button"
            onClick={p.onSign}
            disabled={!p.isConnected || p.tx.isSubmitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all duration-200 glow-purple-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Sign &amp; submit
            <ArrowRight className="w-4 h-4" />
          </button>
        )}

        {onSign && p.isWalletConnect && signWaiting && (
          <button
            type="button"
            onClick={() => {
              const url = p.peerRedirect ?? "enjinwallet://"
              window.location.href = url
            }}
            className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all"
            title="Bring the Enjin Wallet app to the foreground to approve"
          >
            Open Enjin Wallet
          </button>
        )}

        {onSign && (signError || signWaiting) && (
          <button
            type="button"
            onClick={p.onRetry}
            disabled={!p.isConnected || p.tx.isSubmitting}
            className="px-5 py-2.5 rounded-xl border border-purple-border text-sm font-medium text-foreground hover:bg-primary/10 transition-all disabled:opacity-50"
            title={
              signError
                ? "Re-send the same signing request to the wallet"
                : "Cancel and re-send the signing request"
            }
          >
            {signError ? "Retry" : "Resend request"}
          </button>
        )}

        {p.tx.status.kind === "finalized" && (
          <button
            type="button"
            onClick={p.onView}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all duration-200 glow-purple-sm"
          >
            View referendum
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
    </div>
  )
}

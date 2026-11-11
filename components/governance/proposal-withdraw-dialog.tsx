"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useMe } from "@/lib/query/hooks/use-session"
import type { ProposalMetadata } from "@/lib/query/hooks/use-proposal-metadata"
import { useWithdrawProposal } from "@/lib/query/hooks/use-withdraw-proposal"
import { cn } from "@/lib/utils"
import { formatError } from "@/lib/utils/format-error"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  metadata: ProposalMetadata
}

/**
 * Proposer-only dialog to flag (or un-flag) an on-chain proposal as
 * withdrawn off-chain. Substrate's `referenda.cancel()` is gated to
 * the ReferendumCanceller origin - proposers can't cancel themselves
 * - so this is the social signal: voters keep their say, but the
 * banner makes clear the proposer is asking for NAY.
 */
export function ProposalWithdrawDialog({ open, onOpenChange, metadata }: Props) {
  const meQuery = useMe()
  const signedIn = meQuery.data != null
  const alreadyWithdrawn = Boolean(metadata.withdrawn_at)

  const [reason, setReason] = useState(metadata.withdrawn_reason ?? "")
  useEffect(() => {
    if (open) setReason(metadata.withdrawn_reason ?? "")
  }, [open, metadata.withdrawn_reason])

  const withdraw = useWithdrawProposal()

  const trimmedReason = reason.trim()
  const reasonError =
    trimmedReason.length > 280
      ? `Reason must be at most 280 characters (currently ${trimmedReason.length}).`
      : null

  const canSubmit = signedIn && !withdraw.isPending && reasonError == null

  const onConfirm = async () => {
    if (!canSubmit) return
    try {
      await withdraw.mutateAsync({
        id: metadata.id,
        reason: trimmedReason || null,
      })
      toast.success("Proposal marked withdrawn")
      onOpenChange(false)
    } catch (e) {
      toast.error("Could not withdraw", { description: formatError(e) })
    }
  }

  const onUndo = async () => {
    if (!signedIn || withdraw.isPending) return
    try {
      await withdraw.mutateAsync({ id: metadata.id, undo: true })
      toast.success("Withdrawal cleared")
      onOpenChange(false)
    } catch (e) {
      toast.error("Could not clear withdrawal", {
        description: formatError(e),
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-3rem)] max-w-[calc(100%-3rem)] sm:max-w-md p-5 sm:p-6 gap-4 rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {alreadyWithdrawn ? "Clear withdrawal" : "Withdraw Proposal"}
          </DialogTitle>
          <DialogDescription className="text-left">
            {alreadyWithdrawn
              ? "Remove the withdrawal banner so this proposal reads as a normal active referendum again."
              : "Off-chain only. The referendum stays on chain and voting stays open - but the detail page shows a banner asking voters to NAY this one. Use it when you filed by mistake or want to retract."}
          </DialogDescription>
        </DialogHeader>

        {!signedIn && !meQuery.isPending && (
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/30 p-3 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <Link
                href={`/account?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                className="font-medium text-primary hover:text-purple-dim underline-offset-2 hover:underline"
                onClick={() => onOpenChange(false)}
              >
                Sign in
              </Link>{" "}
              with the wallet that filed this proposal.
            </p>
          </div>
        )}

        {!alreadyWithdrawn && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">
                Reason (optional)
              </label>
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  reasonError ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {trimmedReason.length}/280
              </span>
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={400}
              placeholder="e.g. Filed on the wrong network - please vote NAY and I'll re-file on Canary."
              className={cn(
                "w-full px-3 py-2 rounded-lg bg-surface-1 border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1",
                reasonError
                  ? "border-destructive/60 focus:border-destructive/80 focus:ring-destructive/20"
                  : "border-border focus:border-primary/50 focus:ring-primary/20",
              )}
            />
            {reasonError && (
              <p className="text-[11px] text-destructive leading-snug">
                {reasonError}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-end gap-3 pt-1">
          {alreadyWithdrawn ? (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={withdraw.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onUndo}
                disabled={!signedIn || withdraw.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {withdraw.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                Clear withdrawal
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={withdraw.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {withdraw.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : null}
                Mark withdrawn
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

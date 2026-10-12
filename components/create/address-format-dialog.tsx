"use client"

import { ArrowDown, Check, Globe } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

type Props = {
  /** The address as typed, in another network's format. */
  input: string | null
  /** e.g. "Canary Matrixchain", "Polkadot", "raw public key". */
  networkLabel: string
  /** The same key encoded for the active chain - what would be paid. */
  convertedAddress: string
  /** Display name of the active chain, e.g. "Canary Relay". */
  chainShortName: string
  /** True when the converted address is the connected wallet. */
  isOwnWallet: boolean
  onConvert: () => void
  /** Cancel, Esc and tapping outside all clear the field. */
  onCancel: () => void
}

/**
 * Shown when a valid address from another network lands in a beneficiary
 * field. Nothing is converted silently: the user either takes the matching
 * address for this chain or the field is cleared.
 */
export function AddressFormatDialog({
  input,
  networkLabel,
  convertedAddress,
  chainShortName,
  isOwnWallet,
  onConvert,
  onCancel,
}: Props) {
  const article = /^[aeiou]/i.test(networkLabel) ? "an" : "a"
  const label = networkLabel === "raw public key" ? networkLabel : `${networkLabel} address`

  return (
    <Dialog open={input != null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100%-3rem)] max-w-[calc(100%-3rem)] sm:max-w-md p-5 sm:p-6 gap-4 rounded-2xl"
      >
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
          <Globe className="w-5 h-5 text-amber-500" />
        </div>
        <DialogTitle className="text-base leading-snug">
          This is {article} {label}
        </DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">
          Treasury payouts happen on{" "}
          <span className="text-foreground font-medium">{chainShortName}</span>. Here is the
          matching {chainShortName} address for the same wallet.
        </DialogDescription>

        <div className="space-y-2">
          <div className="rounded-xl border border-border bg-surface-1 px-3 py-2.5">
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              <span>You entered</span>
              <span>{networkLabel}</span>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground break-all">{input}</p>
          </div>
          <div className="flex justify-center text-muted-foreground">
            <ArrowDown className="w-3.5 h-3.5" />
          </div>
          <div className="rounded-xl border border-purple-border bg-primary/5 px-3 py-2.5">
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-primary font-medium mb-1">
              <span>{chainShortName} address</span>
              <span>will be paid</span>
            </div>
            <p className="font-mono text-[11px] text-foreground break-all">{convertedAddress}</p>
          </div>
        </div>

        {isOwnWallet && (
          <p className="inline-flex items-center gap-1.5 self-start rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <Check className="w-3 h-3" />
            This is your own connected wallet
          </p>
        )}

        <div className="grid grid-cols-[1fr_1.3fr] gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-surface-1 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConvert}
            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors"
          >
            Convert
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground text-center">
          Cancel clears the field. The payout then defaults to your wallet.
        </p>
      </DialogContent>
    </Dialog>
  )
}

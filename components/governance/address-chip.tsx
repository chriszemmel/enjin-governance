"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { PolkadotIdenticon } from "@/components/profile/identicon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** `enDiPPdUBb…QU2H7X` → `enDiPP…U2H7X`. Display only. */
function middleTruncate(address: string, lead = 6, trail = 5): string {
  return address.length <= lead + trail + 1
    ? address
    : `${address.slice(0, lead)}…${address.slice(-trail)}`
}

/**
 * Compact chip for an address inside proposal text. Tapping copies the
 * full address and opens a small card with it (and a link to the
 * profile); hovering shows it as a tooltip.
 */
export function AddressChip({ address }: { address: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      toast.success("Address copied")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked (http, iframes) - the card still shows it.
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={address}
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 align-baseline max-w-full rounded-full border border-purple-border bg-primary/5 pl-0.5 pr-2 py-px font-mono text-[0.85em] leading-tight text-primary hover:bg-primary/10 transition-colors [overflow-wrap:normal]"
        >
          <PolkadotIdenticon address={address} size={16} className="border-0" />
          <span>{middleTruncate(address)}</span>
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-60" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Address
        </p>
        <p className="font-mono text-xs text-foreground break-all select-all">{address}</p>
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Copy className="w-3 h-3" />
            Copy
          </button>
          <Link
            href={`/user/${address}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:text-purple-dim"
          >
            View profile
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

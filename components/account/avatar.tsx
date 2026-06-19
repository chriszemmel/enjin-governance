"use client"

import { User } from "lucide-react"
import { cn } from "@/lib/utils"
import { PolkadotIdenticon } from "@/components/profile/identicon"

type Size = "sm" | "md" | "lg" | "xl"

const SIZES: Record<Size, string> = {
  sm: "w-6 h-6 text-[10px]",
  md: "w-9 h-9 text-xs",
  lg: "w-12 h-12 text-sm",
  xl: "w-20 h-20 text-lg",
}

const SIZE_PX: Record<Size, number> = {
  sm: 24,
  md: 36,
  lg: 48,
  xl: 80,
}

/**
 * Round avatar tile. Renders the user's uploaded PNG when present;
 * otherwise a deterministic Polkadot identicon when given an address;
 * otherwise an initial-based swatch (used for non-account contexts
 * like comment-form placeholders).
 */
export function Avatar({
  url,
  address,
  fallback,
  size = "md",
  className,
}: {
  url: string | null | undefined
  /** SS58 address - when provided and no `url`, renders a Polkadot identicon. */
  address?: string | null
  /** Initial-based fallback when no `url` and no `address`. */
  fallback: string | null | undefined
  size?: Size
  className?: string
}) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={cn(
          SIZES[size],
          "rounded-full object-cover border border-purple-border bg-surface-2",
          className,
        )}
      />
    )
  }
  if (address) {
    return (
      <PolkadotIdenticon
        address={address}
        size={SIZE_PX[size]}
        className={className}
      />
    )
  }
  const initial = (fallback ?? "?").trim().charAt(0).toUpperCase() || "?"
  const swatch = swatchFor(fallback ?? "")
  return (
    <div
      className={cn(
        SIZES[size],
        "rounded-full inline-flex items-center justify-center font-semibold border border-purple-border",
        swatch,
        className,
      )}
    >
      {initial === "?" ? <User className="w-3.5 h-3.5" /> : initial}
    </div>
  )
}

const SWATCHES = [
  "bg-primary/15 text-primary",
  "bg-emerald-500/15 text-emerald-400",
  "bg-amber-500/15 text-amber-300",
  "bg-rose-500/15 text-rose-300",
  "bg-sky-500/15 text-sky-300",
  "bg-violet-500/15 text-violet-300",
]
function swatchFor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return SWATCHES[hash % SWATCHES.length]!
}

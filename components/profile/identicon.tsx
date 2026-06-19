"use client"

import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"

// @polkadot/react-identicon touches `window` on the polkadot theme to
// derive the colour palette from address bytes. Loading it through
// next/dynamic with ssr:false avoids a hydration mismatch on first
// paint and keeps it out of the server bundle.
const Identicon = dynamic(
  () => import("@polkadot/react-identicon").then((m) => m.Identicon ?? m.default),
  { ssr: false },
)

/**
 * Deterministic Polkadot identicon for an SS58 address. Wrapped in a
 * fixed-size circle so the loading placeholder (rendered while the
 * dynamic chunk fetches) doesn't shift layout.
 */
export function PolkadotIdenticon({
  address,
  size = 24,
  className,
}: {
  address: string
  size?: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-full overflow-hidden bg-surface-2 border border-purple-border flex-shrink-0",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Identicon value={address} size={size} theme="polkadot" />
    </span>
  )
}

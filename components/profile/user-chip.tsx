"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { encodeForChain, shortenAddress } from "@/lib/chain/ss58"
import { useActiveChain } from "@/lib/chain/use-chain"
import { usePublicProfile } from "@/lib/query/hooks/use-profile"
import { PolkadotIdenticon } from "./identicon"
import { ProfileDialog } from "./profile-dialog"

type Size = "xs" | "sm" | "md" | "lg"

const AVATAR_PX: Record<Size, number> = { xs: 16, sm: 20, md: 24, lg: 32 }
const TEXT_CLASS: Record<Size, string> = {
  xs: "text-[11px]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-sm",
}

/**
 * Clickable identity chip - avatar + display name (or @handle, or
 * shortened address) that opens the profile dialog on click. Use this
 * in any list/row that currently renders a raw SS58 address.
 *
 * If the caller wants the bare address text rendered alongside (e.g.
 * "Beneficiary: <address>"), pass `forceAddress` to skip the
 * display_name/handle lookup and render only the shortened address.
 */
export function UserChip({
  address,
  size = "sm",
  className,
  forceAddress = false,
  hideAvatar = false,
}: {
  address: string
  size?: Size
  className?: string
  /** When true, render only the shortened address - never the display name. */
  forceAddress?: boolean
  hideAvatar?: boolean
}) {
  const chain = useActiveChain()
  const [open, setOpen] = useState(false)
  const ss58 = (() => {
    try {
      return encodeForChain(address, chain.id)
    } catch {
      return address
    }
  })()
  const profile = usePublicProfile(forceAddress ? null : ss58)

  const displayName = profile.data?.display_name ?? null
  const handle = profile.data?.handle ?? null
  const labelText = forceAddress
    ? shortenAddress(ss58)
    : (displayName ?? (handle ? `@${handle}` : shortenAddress(ss58)))
  const labelIsAddress = forceAddress || (!displayName && !handle)

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Stop the click from bubbling into a parent <button> or
          // <Link> - common when the chip lives inside a row that is
          // itself clickable (e.g. votes-list rows open a detail
          // modal, comments rows link to the user page).
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
          "max-w-full min-w-0",
          className,
        )}
        title={ss58}
      >
        {!hideAvatar &&
          (profile.data?.avatar_url ? (
            <img
              src={profile.data.avatar_url}
              alt=""
              width={AVATAR_PX[size]}
              height={AVATAR_PX[size]}
              className="rounded-full object-cover border border-purple-border flex-shrink-0"
            />
          ) : (
            <PolkadotIdenticon address={ss58} size={AVATAR_PX[size]} />
          ))}
        <span
          className={cn(
            TEXT_CLASS[size],
            "truncate text-foreground",
            labelIsAddress ? "font-mono" : "font-medium",
          )}
        >
          {labelText}
        </span>
      </button>
      <ProfileDialog open={open} onOpenChange={setOpen} address={ss58} />
    </>
  )
}

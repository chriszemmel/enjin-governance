"use client"

import { useState } from "react"
import { Coins } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePoolNft } from "@/lib/query/hooks/use-pool-nft"

interface PoolNftAvatarProps {
  poolId: number
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZE_CLASS = {
  sm: "w-9 h-9",
  md: "w-12 h-12",
  lg: "w-16 h-16",
} as const

const ICON_CLASS = {
  sm: "w-3.5 h-3.5",
  md: "w-5 h-5",
  lg: "w-6 h-6",
} as const

/**
 * Rounded-square thumbnail for a nomination-pool NFT - the
 * collection's native artwork shape (1:1 portrait on Degens) sits
 * naturally inside a `rounded-lg` frame next to the circular
 * `<EnjAvatar />`. Aye/nay signalling lives on the surrounding card
 * tint, not on a ring around the avatar.
 *
 * Graceful fallbacks: a pulsing placeholder while loading, a coins
 * glyph when the chain has no pool-NFT collection configured or the
 * fetch fails.
 *
 * Wrapping element is a `<span>` so it can sit inside link / button
 * rows without violating block-in-inline nesting rules.
 */
export function PoolNftAvatar({
  poolId,
  size = "sm",
  className,
}: PoolNftAvatarProps) {
  const query = usePoolNft(poolId)
  const [imgError, setImgError] = useState(false)

  const data = query.data
  const imageUrl = data?.metadata?.image ?? null
  const name = data?.metadata?.name ?? data?.pool.name ?? `Pool #${poolId}`
  const showImage = imageUrl != null && !imgError
  const sizeCls = SIZE_CLASS[size]

  if (query.isPending) {
    return (
      <span
        className={cn(
          "inline-block flex-shrink-0 rounded-lg bg-surface-3 animate-pulse",
          sizeCls,
          className,
        )}
        title={`Pool #${poolId}`}
        aria-label={`Pool #${poolId} loading`}
      />
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center flex-shrink-0 rounded-lg overflow-hidden bg-surface-3 text-muted-foreground",
        sizeCls,
        className,
      )}
      title={name}
      aria-label={name}
    >
      {showImage ? (
        <img
          src={imageUrl ?? undefined}
          alt={name}
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <Coins className={ICON_CLASS[size]} aria-hidden />
      )}
    </span>
  )
}

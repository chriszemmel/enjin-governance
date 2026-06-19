import { cn } from "@/lib/utils"

interface EnjAvatarProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZE_CLASS = {
  sm: "w-9 h-9",
  md: "w-12 h-12",
  lg: "w-16 h-16",
} as const

/**
 * Circular Enjin-mark avatar for a liquid-ENJ vote. The brand mark
 * is itself a circle, so a `rounded-full` container with the SVG
 * filling the box edge-to-edge gives a perfectly flush, branded
 * thumbnail. Aye/nay signalling lives on the surrounding card tint
 * - no ring is drawn here.
 */
export function EnjAvatar({ size = "sm", className }: EnjAvatarProps) {
  return (
    <span
      className={cn(
        "inline-block flex-shrink-0 overflow-hidden rounded-full",
        SIZE_CLASS[size],
        className,
      )}
      aria-label="ENJ vote"
    >
      <img
        src="/brand/enjin-mark.svg"
        alt=""
        draggable={false}
        className="block w-full h-full"
      />
    </span>
  )
}

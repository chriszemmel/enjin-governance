import { cn } from "@/lib/utils"
import { formatTrackName } from "@/lib/governance/display"
import type { Track } from "@/lib/governance/types"

interface TrackBadgeProps {
  track: Track | null | undefined
  trackId?: number | null
  className?: string
}

/**
 * Show a referendum's governance track. Renders nothing when neither
 * the full Track nor the numeric trackId is known - typical for
 * terminal referenda where the chain has dropped the track from
 * `ReferendumInfo` and we don't have a fallback source loaded yet.
 *
 * Deliberately plain muted text, not a pill: the track is metadata,
 * not a call to action, and the accent color stays reserved.
 */
export function TrackBadge({ track, trackId, className }: TrackBadgeProps) {
  if (!track && trackId == null) return null
  const label = track ? formatTrackName(track.name) : `Track ${trackId}`
  return (
    <span
      className={cn(
        "inline-flex items-center text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  )
}

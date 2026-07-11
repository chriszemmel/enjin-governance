import { cn } from "@/lib/utils"
import { statusDotClasses, statusLabel } from "@/lib/governance/display"
import type { ReferendumStatusType } from "@/lib/governance/types"

interface StatusChipProps {
  type: ReferendumStatusType
  className?: string
}

/**
 * Referendum status chip: neutral ink on `surface-1`, with the state
 * carried by a 5px dot (purple pulse = active, green = approved,
 * red = rejected/killed, gray = cancelled/timed out). The label always
 * accompanies the dot so state is never color-alone.
 */
export function StatusChip({ type, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1",
        "rounded-full border border-border bg-surface-1 text-foreground/80",
        "uppercase tracking-wide",
        className,
      )}
    >
      <span className={cn("w-[5px] h-[5px] rounded-full flex-shrink-0", statusDotClasses(type))} />
      {statusLabel(type)}
    </span>
  )
}

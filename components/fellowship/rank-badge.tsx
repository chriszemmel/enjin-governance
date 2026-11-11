import { cn } from "@/lib/utils"
import { rankName, rankNumeral } from "@/lib/governance/fellowship"

/**
 * "VII Master": a member's rank. Grand Masters filled, fellows (rank III
 * and up) in the accent, the ranks below neutral. `short` shows the
 * numeral alone, beside an address.
 */
export function RankBadge({
  rank,
  short = false,
  className,
}: {
  rank: number
  short?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        rank >= 9
          ? "bg-primary text-primary-foreground"
          : rank >= 3
            ? "border border-purple-border bg-primary/10 text-primary"
            : "border border-border bg-surface-1 text-foreground",
        className,
      )}
    >
      {short ? (
        rankNumeral(rank)
      ) : (
        <>
          <span>{rankNumeral(rank)}</span> {rankName(rank)}
        </>
      )}
    </span>
  )
}

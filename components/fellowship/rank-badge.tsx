import { cn } from "@/lib/utils"
import { rankName, rankNumeral } from "@/lib/governance/fellowship"

/** "VII Master": a member's rank, filled for the top ranks. */
export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const top = rank >= 9
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        top
          ? "bg-primary text-primary-foreground"
          : "border border-purple-border bg-primary/8 text-primary",
        className,
      )}
    >
      <span className="font-mono">{rankNumeral(rank)}</span>
      {rankName(rank)}
    </span>
  )
}

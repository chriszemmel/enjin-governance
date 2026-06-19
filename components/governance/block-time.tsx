"use client"

import { cn } from "@/lib/utils"
import {
  blockToDate,
  formatAbsoluteTime,
  formatRelativeBlockTime,
} from "@/lib/chain/format"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"

interface BlockTimeProps {
  block: number
  /** Show "#1,234,567" alongside the relative time. */
  showBlock?: boolean
  /** Render absolute UTC date instead of relative. */
  absolute?: boolean
  className?: string
}

/**
 * Renders a block number as a human-readable time, anchored to the current
 * block height. Title attribute carries the full UTC timestamp for hover.
 */
export function BlockTime({
  block,
  showBlock = false,
  absolute = false,
  className,
}: BlockTimeProps) {
  const currentBlock = useCurrentBlock().data

  const date =
    currentBlock != null ? blockToDate(block, currentBlock) : null
  const relative = formatRelativeBlockTime(block, currentBlock)
  const abs = date ? formatAbsoluteTime(date) : null

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={abs ?? undefined}>
      <span>{absolute && abs ? abs : relative}</span>
      {showBlock && (
        <span className="text-[10px] text-muted-foreground font-mono">
          #{block.toLocaleString("en-US")}
        </span>
      )}
    </span>
  )
}

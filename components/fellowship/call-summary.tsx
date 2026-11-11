"use client"

import type { Referendum } from "@/lib/governance/types"
import { useInlineCall, usePreimage } from "@/lib/query/hooks/use-preimage"

/**
 * The decoded call of an ongoing referendum (or of a decided one's
 * history, read at `atBlock`), inline or from its preimage.
 */
export function useDecodedCall(referendum: Referendum | null | undefined, atBlock?: number | null) {
  const status = referendum?.status
  const proposal = status?.type === "Ongoing" ? status.proposal : null
  const inline = proposal && "type" in proposal ? proposal.bytes : null
  const lookup = proposal && !("type" in proposal) ? proposal : null
  const inlineQuery = useInlineCall(inline, atBlock)
  const lookupQuery = usePreimage(lookup, undefined, atBlock)
  return (inline ? inlineQuery.data : lookupQuery.data) ?? null
}

"use client"

import type { Referendum } from "@/lib/governance/types"
import { useInlineCall, usePreimage } from "@/lib/query/hooks/use-preimage"

/**
 * `section.method` of a referendum's call, for titles and cards. Fellowship
 * referenda have no EGOV1 text yet, so the call is what names them.
 */
export function useCallName(referendum: Referendum | null | undefined): string | null {
  const status = referendum?.status
  const proposal = status?.type === "Ongoing" ? status.proposal : null
  const inline = proposal && "type" in proposal ? proposal.bytes : null
  const lookup = proposal && !("type" in proposal) ? proposal : null
  const inlineQuery = useInlineCall(inline)
  const lookupQuery = usePreimage(lookup)
  const decoded = inline ? inlineQuery.data : lookupQuery.data
  return decoded ? `${decoded.section}.${decoded.method}` : null
}

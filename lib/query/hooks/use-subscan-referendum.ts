"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import type { SubscanReferendumData } from "@/lib/subscan/client"

/**
 * Subscan-backed enrichment for a referendum. Used as a fallback when
 * on-chain historical state has been pruned (old finalised referenda).
 *
 * Returns null when Subscan isn't configured for the chain, the index
 * doesn't exist, or the API key is missing and the public quota is
 * exhausted. The UI degrades gracefully in any of these cases.
 */
export function useSubscanReferendum(
  index: number | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  return useQuery<SubscanReferendumData | null>({
    queryKey: ["subscan-referendum", target.id, index],
    queryFn: async () => {
      if (index == null) return null
      const res = await fetch(`/api/subscan/${target.id}/referendum/${index}`)
      if (!res.ok) return null
      const body = (await res.json()) as { data: SubscanReferendumData | null }
      return body.data
    },
    enabled: index != null && index >= 0,
    // Match the CDN cache - 5 min staleTime, 1 h gcTime - so we don't
    // refetch faster than the cache can dedupe. Subscan has a 5 req/s
    // hard limit.
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  })
}

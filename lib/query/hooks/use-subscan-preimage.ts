"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import type { SubscanPreimageData } from "@/lib/subscan/client"

/**
 * Subscan-backed preimage lookup by hash. Used as the third tier when
 * the on-chain `preimage.preimageFor` map is missing (typical for old
 * referenda - the chain prunes the bytes but Subscan indexes them
 * before they go away).
 */
export function useSubscanPreimage(
  hash: `0x${string}` | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  return useQuery<SubscanPreimageData | null>({
    queryKey: ["subscan-preimage", target.id, hash],
    queryFn: async () => {
      if (!hash) return null
      const res = await fetch(`/api/subscan/${target.id}/preimage/${hash}`)
      if (!res.ok) return null
      const body = (await res.json()) as { data: SubscanPreimageData | null }
      return body.data
    },
    enabled: !!hash,
    // Preimage bytes are immutable - cache for an hour, hold in memory
    // for the rest of the session.
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  })
}

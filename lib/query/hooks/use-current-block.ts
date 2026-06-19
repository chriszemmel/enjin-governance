"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { useApi } from "./use-api"

/**
 * Latest block height for the active chain. Refreshes every 6s (~1 block).
 * Used as the anchor for converting historical block numbers into times.
 */
export function useCurrentBlock(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<number>({
    queryKey: ["current-block", target.id],
    queryFn: async () => {
      if (!apiQuery.data) throw new Error("API not ready")
      const header = await apiQuery.data.rpc.chain.getHeader()
      return (header.number as unknown as { toNumber: () => number }).toNumber()
    },
    enabled: apiQuery.isSuccess,
    staleTime: 3_000,
    refetchInterval: 6_000,
  })
}

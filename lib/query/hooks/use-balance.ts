"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { useApi } from "./use-api"

/**
 * Read the free balance for an address. Refreshes every 12s (~2 blocks).
 * Returns null balance while no address is connected.
 */
export function useBalance(address: string | null | undefined, chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery({
    queryKey: ["balance", target.id, address],
    queryFn: async () => {
      if (!address) return null
      if (!apiQuery.data) throw new Error("API not ready")
      const account = await apiQuery.data.query.system.account(address)
      const data = (account as unknown as { data: { free: { toString(): string } } }).data
      return BigInt(data.free.toString())
    },
    enabled: !!address && apiQuery.isSuccess,
    staleTime: 6_000,
    refetchInterval: 12_000,
  })
}

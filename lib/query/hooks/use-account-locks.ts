"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  getAccountLocks,
  type TrackLock,
} from "@/lib/governance/conviction-voting"
import { useApi } from "./use-api"

/**
 * Per-track conviction locks for an address - frozen amount, residual
 * unlock-at, and any votes still holding a lock. Refreshes every 24s.
 * Returns an empty list while no address is connected.
 */
export function useAccountLocks(
  address: string | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<TrackLock[]>({
    queryKey: ["account-locks", target.id, address],
    queryFn: async () => {
      if (!address) return []
      if (!apiQuery.data) throw new Error("API not ready")
      return getAccountLocks(apiQuery.data, address)
    },
    enabled: !!address && apiQuery.isSuccess,
    staleTime: 12_000,
    refetchInterval: 24_000,
  })
}

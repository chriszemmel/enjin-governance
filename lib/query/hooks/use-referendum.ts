"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { getReferendum } from "@/lib/governance/referenda"
import type { Referendum } from "@/lib/governance/types"
import { queryKeys } from "@/lib/query/keys"
import { useApi } from "./use-api"

/**
 * Read a single referendum. Polls every 10s while ongoing, then settles
 * to the default 60s once the referendum reaches a terminal state.
 */
export function useReferendum(index: number, chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<Referendum | null>({
    queryKey: queryKeys.referenda.detail(target.id, index),
    queryFn: () => {
      if (!apiQuery.data) throw new Error("API not ready")
      return getReferendum(apiQuery.data, index)
    },
    enabled: apiQuery.isSuccess && Number.isInteger(index) && index >= 0,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const ref = query.state.data
      return ref?.status.type === "Ongoing" ? 10_000 : 60_000
    },
  })
}

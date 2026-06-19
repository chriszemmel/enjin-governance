"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  getDelegationsFor,
  type Delegation,
} from "@/lib/governance/conviction-voting"
import { useApi } from "./use-api"

/**
 * Active delegations for `address` - one per (track, currency). Drives the
 * account page's Delegation panel.
 */
export function useDelegations(
  address: string | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<Delegation[]>({
    queryKey: ["delegations", target.id, address],
    queryFn: async () => {
      if (!apiQuery.data || !address) return []
      return getDelegationsFor(apiQuery.data, address)
    },
    enabled: apiQuery.isSuccess && !!address,
    staleTime: 12_000,
  })
}

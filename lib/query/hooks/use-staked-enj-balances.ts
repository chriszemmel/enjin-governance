"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  getStakedEnjBalances,
  type StakedEnjHolding,
} from "@/lib/governance/staking-pools"
import { useApi } from "./use-api"

/**
 * Per-pool sENJ holdings for `address`. Returns:
 *   - `[]` while no address is connected, on unsupported chains
 *     (canary / matrix without a configured pool collection), or
 *     when the wallet holds no sENJ;
 *   - one entry per pool with a non-zero balance otherwise.
 *
 * Refreshes every ~24s (4 blocks) - sENJ balances change rarely
 * relative to vote intent, so we don't need to be aggressive.
 */
export function useStakedEnjBalances(
  address: string | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const collectionId = target.sEnjCollectionId
  return useQuery<StakedEnjHolding[]>({
    queryKey: ["senj-balances", target.id, address],
    queryFn: async () => {
      if (!apiQuery.data || !address || collectionId == null) return []
      return getStakedEnjBalances(apiQuery.data, address, collectionId)
    },
    enabled: !!address && apiQuery.isSuccess && collectionId != null,
    staleTime: 12_000,
    refetchInterval: 24_000,
  })
}

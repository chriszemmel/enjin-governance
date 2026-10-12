"use client"

import { useQuery } from "@tanstack/react-query"
import type { ApiPromise } from "@polkadot/api"
import { getApi } from "@/lib/chain/api"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { queryKeys } from "@/lib/query/keys"

/**
 * Cached ApiPromise against the chain's archive endpoint, if configured.
 *
 * The archive endpoints are Enjin's own (`archive.*.enjin.io`, see
 * lib/chain/chains.ts). Falls back to the primary RPC when none is set -
 * at which point `api.at(oldBlockHash)` queries will only succeed for
 * the most recent ~256 blocks.
 */
export function useArchiveApi(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const endpoint = target.archiveRpc ?? target.rpc
  return useQuery<ApiPromise>({
    queryKey: queryKeys.api(endpoint),
    queryFn: () => getApi(endpoint),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 3,
  })
}

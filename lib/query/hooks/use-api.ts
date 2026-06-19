"use client"

import { useQuery } from "@tanstack/react-query"
import type { ApiPromise } from "@polkadot/api"
import { getApi } from "@/lib/chain/api"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { queryKeys } from "@/lib/query/keys"

/**
 * Get a cached ApiPromise for the active chain. Re-keys + re-fetches on
 * network switch (the lib/chain/api.ts pool caches one socket per RPC URL,
 * so we don't pay the connect cost on every render).
 *
 * Pass an explicit `chain` to read from a non-default network.
 */
export function useApi(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  return useQuery<ApiPromise>({
    queryKey: queryKeys.api(target.rpc),
    queryFn: () => getApi(target.rpc),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 3,
  })
}

"use client"

import { useQuery } from "@tanstack/react-query"
import type { ApiPromise } from "@polkadot/api"
import { getApi, preloadApiLibrary } from "@/lib/chain/api"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { queryKeys } from "@/lib/query/keys"

// The API library loads on demand (see lib/chain/api.ts). A page that reads
// the chain loads this module with its first scripts: fetch the library
// alongside them, before the page hydrates. Modules that load after the
// page (routes prefetched for later navigation) leave it to useApi.
if (typeof document !== "undefined" && document.readyState !== "complete") {
  void preloadApiLibrary().catch(() => {})
}

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
  // After a client-side navigation: start the load while rendering, before
  // the query runs. Once loaded (or loading) this does nothing.
  if (typeof window !== "undefined") void preloadApiLibrary().catch(() => {})
  return useQuery<ApiPromise>({
    queryKey: queryKeys.api(target.rpc),
    queryFn: () => getApi(target.rpc),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 3,
  })
}

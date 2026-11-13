"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { useApi } from "./use-api"
import { useSpecVersion } from "./use-spec-version"

/**
 * `api.consts.referenda.undecidingTimeout`: blocks after submission a
 * referendum without a decision deposit times out. A runtime constant, so
 * keyed on the spec version like the tracks. Null on a runtime without it.
 */
export function useUndecidingTimeout(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const specVersion = useSpecVersion(target)
  return useQuery<number | null>({
    queryKey: ["undeciding-timeout", target.id, specVersion],
    queryFn: () => {
      const api = apiQuery.data
      if (!api) throw new Error("API not ready")
      const raw = api.consts.referenda?.undecidingTimeout as { toNumber?: () => number } | undefined
      return raw?.toNumber ? raw.toNumber() : null
    },
    enabled: apiQuery.isSuccess && specVersion != null,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

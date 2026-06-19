"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { getTracks } from "@/lib/governance/tracks"
import type { Track } from "@/lib/governance/types"
import { queryKeys } from "@/lib/query/keys"
import { useApi } from "./use-api"

/**
 * Read the chain's referenda track config. Tracks change only on runtime
 * upgrade, so we cache forever and never refetch on focus.
 */
export function useTracks(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<Track[]>({
    queryKey: queryKeys.tracks(target.id),
    queryFn: () => {
      if (!apiQuery.data) throw new Error("API not ready")
      return getTracks(apiQuery.data)
    },
    enabled: apiQuery.isSuccess,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

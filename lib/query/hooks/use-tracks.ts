"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { getTracks } from "@/lib/governance/tracks"
import type { Track } from "@/lib/governance/types"
import { queryKeys } from "@/lib/query/keys"
import { useApi } from "./use-api"
import { useSpecVersion } from "./use-spec-version"

/**
 * Read the chain's referenda track config. Tracks change only on a runtime
 * upgrade, so the query is keyed on the spec version and never refetches
 * otherwise: when an open tab sees an upgrade, the key changes and the new
 * table is decoded (the old one shows until then, not a loading state).
 */
export function useTracks(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const specVersion = useSpecVersion(target)
  return useQuery<Track[]>({
    queryKey: queryKeys.tracks(target.id, specVersion),
    queryFn: () => {
      if (!apiQuery.data) throw new Error("API not ready")
      return getTracks(apiQuery.data)
    },
    enabled: apiQuery.isSuccess && specVersion != null,
    staleTime: Infinity,
    gcTime: Infinity,
    // The previous runtime's table, only for the same chain (never another
    // network's tracks while a switch loads).
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === target.id ? previous : undefined,
  })
}

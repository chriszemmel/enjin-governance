"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  getReferendumCount,
  listReferenda,
  type ReferendumFilter,
} from "@/lib/governance/referenda"
import type { Referendum } from "@/lib/governance/types"
import { queryKeys } from "@/lib/query/keys"
import { useApi } from "./use-api"

/**
 * List every referendum on chain, optionally filtered by trackId/status.
 * Refetches every 60s while the page is visible.
 */
export function useReferenda(filter: ReferendumFilter = {}, chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<Referendum[]>({
    queryKey: queryKeys.referenda.list(target.id, filter),
    queryFn: () => {
      if (!apiQuery.data) throw new Error("API not ready")
      return listReferenda(apiQuery.data, filter)
    },
    enabled: apiQuery.isSuccess,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/**
 * `referenda.referendumCount()` - the index the next submission will be
 * assigned. Kept deliberately short-stale: the create flow refetches it
 * imperatively right before signing so the setMetadata call in the batch
 * targets the index referenda.submit is about to mint.
 */
export function useReferendumCount(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<number>({
    queryKey: queryKeys.referenda.count(target.id),
    queryFn: () => {
      if (!apiQuery.data) throw new Error("API not ready")
      return getReferendumCount(apiQuery.data)
    },
    enabled: apiQuery.isSuccess,
    staleTime: 10_000,
  })
}

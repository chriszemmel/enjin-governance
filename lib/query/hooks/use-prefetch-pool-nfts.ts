"use client"

import { useEffect, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  buildTokenMetadataUrl,
  fetchTokenMetadata,
  getCollectionUriTemplate,
} from "@/lib/governance/multi-tokens"
import { getPool } from "@/lib/governance/staking-pools"
import { useApi } from "./use-api"

/**
 * Prefetch every pool NFT in `poolIds` so the thumbnails are warm in
 * the React Query cache by the time the user expands "Show more".
 * Uses the same query key as `usePoolNft` (`["pool-nft", chainId,
 * poolId]`) so cached entries dedupe with the rendering hook.
 *
 * Best-effort: ignores failures; the per-row hook will just refetch
 * on render if a prefetch didn't land.
 */
export function usePrefetchPoolNfts(
  poolIds: readonly number[],
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const queryClient = useQueryClient()
  const collectionId = target.stakingPoolNftCollectionId

  // Stable key for the effect so we don't re-prefetch every render
  // when the parent rebuilds the array.
  const idsKey = useMemo(
    () => Array.from(new Set(poolIds)).sort((a, b) => a - b).join(","),
    [poolIds],
  )

  useEffect(() => {
    if (!apiQuery.data || collectionId == null || idsKey === "") return
    const api = apiQuery.data
    const ids = idsKey.split(",").map(Number)

    let cancelled = false
    void Promise.all(
      ids.map((poolId) =>
        queryClient.prefetchQuery({
          queryKey: ["pool-nft", target.id, poolId],
          queryFn: async () => {
            if (cancelled) return null
            const pool = await getPool(api, poolId)
            if (!pool) return null
            const template = await getCollectionUriTemplate(api, collectionId)
            if (!template) return { pool, collectionId, metadata: null }
            const url = buildTokenMetadataUrl(template, collectionId, pool.tokenId)
            const metadata = await fetchTokenMetadata(url)
            return { pool, collectionId, metadata }
          },
          staleTime: 30 * 60 * 1_000,
        }),
      ),
    )

    return () => {
      cancelled = true
    }
  }, [apiQuery.data, collectionId, idsKey, queryClient, target.id])
}

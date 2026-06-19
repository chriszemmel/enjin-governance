"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  buildTokenMetadataUrl,
  fetchTokenMetadata,
  getCollectionUriTemplate,
  type TokenMetadata,
} from "@/lib/governance/multi-tokens"
import { getPool, type PoolInfo } from "@/lib/governance/staking-pools"
import { useApi } from "./use-api"

type PoolNftData = {
  pool: PoolInfo
  collectionId: bigint
  /** Null when the collection has no `uri` template or the metadata fetch failed. */
  metadata: TokenMetadata | null
}

/**
 * Resolve a nomination-pool id to its on-chain NFT and off-chain
 * metadata. Returns:
 *
 *   • `null` when the chain doesn't expose a pool-NFT collection
 *     (canary / matrix in their current state), or the pool can't be
 *     found on chain.
 *   • `{ pool, collectionId, metadata: null }` when the collection
 *     has no URI template or the metadata fetch fails - caller falls
 *     back to text labels.
 *   • `{ pool, collectionId, metadata }` on the happy path.
 *
 * React Query dedupes by `["pool-nft", chainId, poolId]`, so 20 votes
 * on the same pool collapse to one chain+CDN fetch.
 */
export function usePoolNft(
  poolId: number | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const collectionId = target.stakingPoolNftCollectionId
  const enabled =
    apiQuery.isSuccess &&
    poolId != null &&
    Number.isFinite(poolId) &&
    poolId >= 0 &&
    collectionId != null

  return useQuery<PoolNftData | null>({
    queryKey: ["pool-nft", target.id, poolId ?? -1],
    queryFn: async () => {
      if (!apiQuery.data || poolId == null || collectionId == null) return null
      const api = apiQuery.data
      const pool = await getPool(api, poolId)
      if (!pool) return null
      const template = await getCollectionUriTemplate(api, collectionId)
      if (!template) return { pool, collectionId, metadata: null }
      const url = buildTokenMetadataUrl(template, collectionId, pool.tokenId)
      const metadata = await fetchTokenMetadata(url)
      return { pool, collectionId, metadata }
    },
    enabled,
    // The pool tokenId is immutable; metadata changes are rare and the
    // CDN itself caches aggressively. 30 min in-app keeps us snappy
    // without serving stale images all session.
    staleTime: 30 * 60 * 1_000,
    gcTime: 24 * 60 * 60 * 1_000,
    retry: 1,
  })
}

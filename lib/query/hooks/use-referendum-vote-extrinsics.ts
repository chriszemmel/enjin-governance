"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { encodeForChain, encodePublicKeyForChain } from "@/lib/chain/ss58"

type SubscanVoteRow = {
  /** "<block>-<event>" identifier used in subscanExtrinsicUrl. */
  extrinsicIndex: string | null
  /** Currency raw payload - used as a fallback when the chain didn't surface one. */
  currencyRaw: unknown
}

/**
 * Map of voter address → Subscan enrichment data for the votes on
 * `index`. Two pieces of metadata:
 *
 *   • `extrinsicIndex` - upgrades the per-vote link from the voter's
 *     account page to the specific vote extrinsic.
 *   • `currencyRaw` - used as a fallback for the chain-sourced
 *     currency in case the chain query came back null (wrong key
 *     order, missing storage entry, etc.).
 *
 * Best-effort: returns an empty map when Subscan isn't configured for
 * this chain (canary), when the API key is missing and the public
 * quota is exhausted, or when the fetch fails. The UI degrades to the
 * existing account link and chain-only currency in any of those
 * cases.
 */
export function useReferendumVoteExtrinsics(
  index: number | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active

  return useQuery<Map<string, SubscanVoteRow>>({
    queryKey: ["referendum-vote-extrinsics", target.id, index],
    queryFn: async () => {
      if (index == null) return new Map()
      const res = await fetch(`/api/subscan/${target.id}/votes/${index}`)
      if (!res.ok) return new Map()
      const body = (await res.json()) as {
        data: Array<{
          voter: string
          extrinsicIndex: string | null
          currencyRaw: unknown
        }> | null
      }
      const rows = body.data ?? []
      const map = new Map<string, SubscanVoteRow>()
      for (const row of rows) {
        if (!row.voter) continue
        const value: SubscanVoteRow = {
          extrinsicIndex: row.extrinsicIndex ?? null,
          currencyRaw: row.currencyRaw ?? null,
        }
        for (const key of addressKeys(row.voter, target)) {
          map.set(key, value)
        }
      }
      return map
    },
    enabled: index != null && index >= 0,
    // CDN side caches Subscan responses for 5 min (s-maxage). Match
    // here so we don't refetch faster than the cache dedupes.
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  })
}

/**
 * Build every normalised key form a voter address might take, so the
 * map lookup hits regardless of whether Subscan returned a hex
 * pubkey, an SS58 from a different chain's prefix, or the canonical
 * form for this chain.
 */
function addressKeys(addr: string, chain: ChainConfig): string[] {
  const keys = new Set<string>([addr])
  if (/^0x[0-9a-fA-F]{64}$/.test(addr)) {
    try {
      keys.add(encodePublicKeyForChain(addr, chain.id))
    } catch {
      // ignore - leave the hex form as the only key
    }
  } else {
    try {
      keys.add(encodeForChain(addr, chain.id))
    } catch {
      // ignore - leave the original form as the only key
    }
  }
  return Array.from(keys)
}

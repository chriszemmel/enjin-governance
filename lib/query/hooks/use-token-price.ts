"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"

/**
 * Live ENJ/USD price from CoinGecko's public free endpoint. Cached for
 * 5 minutes (CoinGecko's anonymous rate limit is generous but not infinite).
 *
 * Returns null on testnets (no liquid market). On a transient CoinGecko
 * failure the query throws rather than returning null - React Query then
 * retries with backoff and keeps the last good price as `data`, so the UI
 * keeps showing it instead of blanking out.
 */
export function useTokenPrice(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const id = target.coingeckoId

  return useQuery<number | null>({
    queryKey: ["coingecko-price", id],
    queryFn: async () => {
      if (!id) return null
      // Throw (don't swallow) on failure. A swallowed error returns null,
      // which React Query reads as a *successful* result: it skips the
      // retry, then caches null for the full staleTime window - which is
      // why the price would vanish for ~5 minutes after a single blip.
      // Throwing keeps the previous successful `data` in place and lets the
      // retry/backoff run.
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
        { cache: "no-store" },
      )
      if (!res.ok) {
        throw new Error(`CoinGecko price request failed: ${res.status}`)
      }
      const data = (await res.json()) as Record<string, { usd?: number }>
      const usd = data[id]?.usd
      if (usd == null) {
        throw new Error(`CoinGecko returned no USD price for "${id}"`)
      }
      return usd
    },
    enabled: id != null,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 2,
  })
}

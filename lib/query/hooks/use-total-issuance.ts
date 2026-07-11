"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { useApi } from "./use-api"

/**
 * Total token issuance for the active chain, as a bigint (planck).
 *
 * The support threshold is measured against total issuance -
 * `tally.support / totalIssuance` - so the Decision slide needs this
 * denominator to turn raw support into the percentage the support curve
 * evaluates against. Issuance drifts only slowly (staking rewards, fees),
 * so a 60s stale window is plenty.
 */
export function useTotalIssuance(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<bigint>({
    queryKey: ["total-issuance", target.id],
    queryFn: async () => {
      if (!apiQuery.data) throw new Error("API not ready")
      const issuance = await apiQuery.data.query.balances.totalIssuance()
      return (issuance as unknown as { toBigInt: () => bigint }).toBigInt()
    },
    enabled: apiQuery.isSuccess,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

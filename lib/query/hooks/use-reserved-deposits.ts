"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  getPreimageDepositsFor,
  getReferendumDepositsFor,
  type PreimageDeposit,
  type ReferendumDeposit,
} from "@/lib/governance/deposits"
import { useApi } from "./use-api"

type ReservedDeposits = {
  referendumDeposits: ReferendumDeposit[]
  preimageDeposits: PreimageDeposit[]
  /** Sum of every deposit found, reclaimable or not. */
  total: bigint
}

/**
 * Every governance deposit the address has tied up on chain - referendum
 * submission/decision deposits and noted-preimage deposits - so the account
 * page can show where "reserved" balance went and offer to reclaim it.
 */
export function useReservedDeposits(
  address: string | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<ReservedDeposits>({
    queryKey: ["reserved-deposits", target.id, address],
    queryFn: async () => {
      if (!apiQuery.data || !address) {
        return { referendumDeposits: [], preimageDeposits: [], total: 0n }
      }
      const api = apiQuery.data
      const [referendumDeposits, preimageDeposits] = await Promise.all([
        getReferendumDepositsFor(api, address),
        getPreimageDepositsFor(api, address),
      ])
      const total =
        referendumDeposits.reduce((s, d) => s + d.amount, 0n) +
        preimageDeposits.reduce((s, d) => s + d.amount, 0n)
      return { referendumDeposits, preimageDeposits, total }
    },
    enabled: apiQuery.isSuccess && !!address,
    staleTime: 30_000,
  })
}

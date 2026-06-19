"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { getReferendumHistory } from "@/lib/governance/referenda"
import type { Referendum } from "@/lib/governance/types"
import { useArchiveApi } from "./use-archive-api"

/**
 * For a terminal-status referendum (Approved / Rejected / …) the on-chain
 * variant drops the tally + preimage ref + submitted block, keeping only
 * the finalisation block + deposits. Re-read state at the block right
 * before finalisation to recover that history.
 *
 * Routes through the archive RPC (when one is configured for the chain)
 * because the primary endpoint is usually a full node and prunes
 * historical state after ~256 blocks. Falls back to null if even the
 * archive can't produce the state.
 */
export function useReferendumHistory(
  index: number,
  atBlock: number | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useArchiveApi(target)
  return useQuery<Referendum | null>({
    queryKey: ["referendum-history", target.id, index, atBlock],
    queryFn: () => {
      if (!apiQuery.data || atBlock == null) return null
      return getReferendumHistory(apiQuery.data, index, atBlock)
    },
    enabled: apiQuery.isSuccess && atBlock != null && atBlock > 1,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

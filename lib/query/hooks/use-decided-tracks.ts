"use client"

import { useQueries } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { getReferendumHistory } from "@/lib/governance/referenda"
import type { Referendum } from "@/lib/governance/types"
import { useArchiveApi } from "./use-archive-api"

/**
 * The tracks of decided referenda. Once a referendum is decided the chain
 * keeps only its outcome and deposits, not its track, so lists that filter
 * or label by track (the treasury page, proposal cards) read it from the
 * archive at the block before the decision. Same query and cache entry as
 * `useReferendumHistory`, so the detail page reuses it.
 *
 * `pending` stays true while any of them is still loading; `failed` says
 * some couldn't be read (no archive), so counts built on them are short.
 */
export function useDecidedTracks(referenda: Referendum[], chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useArchiveApi(target)
  const decided = referenda.filter(
    (r): r is Referendum & { status: { at: number } } =>
      r.trackId == null && r.status.type !== "Ongoing" && r.status.at > 1,
  )
  return useQueries({
    queries: decided.map((r) => ({
      queryKey: ["referendum-history", target.id, r.index, r.status.at],
      queryFn: () =>
        apiQuery.data ? getReferendumHistory(apiQuery.data, r.index, r.status.at) : null,
      enabled: apiQuery.isSuccess,
      staleTime: Infinity,
      gcTime: Infinity,
    })),
    combine: (results) => {
      const tracks = new Map<number, number>()
      results.forEach((result, i) => {
        const status = result.data?.status
        if (status?.type === "Ongoing") tracks.set(decided[i]!.index, status.trackId)
      })
      return {
        tracks,
        pending: !apiQuery.isError && results.some((r) => r.isPending),
        failed:
          apiQuery.isError ||
          results.some((r, i) => r.isError || (r.isSuccess && !tracks.has(decided[i]!.index))),
      }
    },
  })
}

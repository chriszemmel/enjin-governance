"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  getMyVotesOnPoll,
  getMyVotesOnPollAnyTrack,
  type MyVoteOnPoll,
} from "@/lib/governance/conviction-voting"
import { useApi } from "./use-api"

/**
 * Reads every vote the connected address has cast on a single poll,
 * one row per currency (liquid ENJ + each sENJ pool independently).
 * Sorted by raw voting weight descending so the highest-impact
 * source comes first when the UI renders a stack or swiper.
 *
 * When `trackId` is null (terminal referenda don't expose it) we fall back to
 * the cross-track scan so the user's persisted votes - and the ability to
 * remove them - still surface after a referendum concludes.
 */
export function useMyVotesOnPoll(
  address: string | null | undefined,
  trackId: number | null | undefined,
  pollIndex: number | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<MyVoteOnPoll[]>({
    queryKey: ["my-votes", target.id, address, trackId, pollIndex],
    queryFn: async () => {
      if (!apiQuery.data || !address || pollIndex == null) return []
      return trackId == null
        ? getMyVotesOnPollAnyTrack(apiQuery.data, address, pollIndex)
        : getMyVotesOnPoll(apiQuery.data, address, trackId, pollIndex)
    },
    enabled: apiQuery.isSuccess && !!address && pollIndex != null,
    staleTime: 12_000,
    refetchInterval: 24_000,
  })
}

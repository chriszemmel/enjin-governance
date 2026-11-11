"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  type FellowshipMember,
  type FellowshipReferendum,
  type FellowshipVote,
  getFellowshipReferendum,
  getFellowshipTracks,
  getMyFellowshipVote,
  hasFellowship,
  listFellowshipReferenda,
  listFellowshipVotes,
  listMembers,
} from "@/lib/governance/fellowship"
import type { Track } from "@/lib/governance/types"
import { samePublicKey } from "@/lib/chain/ss58"
import { useApi } from "./use-api"
import { useSpecVersion } from "./use-spec-version"

/** Whether the active chain runs a Fellowship; undefined while connecting. */
export function useHasFellowship(chain?: ChainConfig): boolean | undefined {
  const active = useActiveChain()
  const apiQuery = useApi(chain ?? active)
  return apiQuery.data ? hasFellowship(apiQuery.data) : undefined
}

/** Every member and rank, highest first. Changes only through referenda. */
export function useFellowshipMembers(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<FellowshipMember[]>({
    queryKey: ["fellowship", target.id, "members"],
    queryFn: () => listMembers(apiQuery.data!),
    enabled: apiQuery.isSuccess && hasFellowship(apiQuery.data),
    staleTime: 60_000,
  })
}

/** The connected account's rank, or null when it isn't a member. */
export function useMyRank(address: string | null | undefined, chain?: ChainConfig) {
  const members = useFellowshipMembers(chain)
  const rank =
    address && members.data
      ? (members.data.find((m) => samePublicKey(m.address, address))?.rank ?? null)
      : null
  return { rank, isPending: members.isPending }
}

/** The fellowship track table, keyed on the spec like the public one. */
export function useFellowshipTracks(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const specVersion = useSpecVersion(target)
  return useQuery<Track[]>({
    queryKey: ["fellowship", target.id, "tracks", specVersion],
    queryFn: () => getFellowshipTracks(apiQuery.data!),
    enabled: apiQuery.isSuccess && hasFellowship(apiQuery.data) && specVersion != null,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

export function useFellowshipReferenda(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<FellowshipReferendum[]>({
    queryKey: ["fellowship", target.id, "referenda"],
    queryFn: () => listFellowshipReferenda(apiQuery.data!),
    enabled: apiQuery.isSuccess && hasFellowship(apiQuery.data),
    staleTime: 15_000,
  })
}

export function useFellowshipReferendum(index: number, chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<FellowshipReferendum | null>({
    queryKey: ["fellowship", target.id, "referendum", index],
    queryFn: () => getFellowshipReferendum(apiQuery.data!, index),
    enabled:
      apiQuery.isSuccess && hasFellowship(apiQuery.data) && Number.isInteger(index) && index >= 0,
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.status.type === "Ongoing" ? 10_000 : 60_000),
  })
}

/** Every vote on a fellowship referendum. Votes are cleaned up after it ends. */
export function useFellowshipVotes(index: number, chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<(FellowshipVote & { voter: string })[]>({
    queryKey: ["fellowship", target.id, "votes", index],
    queryFn: () => listFellowshipVotes(apiQuery.data!, index),
    enabled: apiQuery.isSuccess && hasFellowship(apiQuery.data) && index >= 0,
    staleTime: 15_000,
  })
}

export function useMyFellowshipVote(
  index: number,
  address: string | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<FellowshipVote | null>({
    queryKey: ["fellowship", target.id, "my-vote", index, address],
    queryFn: () => getMyFellowshipVote(apiQuery.data!, index, address!),
    enabled: apiQuery.isSuccess && hasFellowship(apiQuery.data) && !!address && index >= 0,
    staleTime: 10_000,
  })
}

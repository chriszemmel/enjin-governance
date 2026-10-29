"use client"

import { useQuery } from "@tanstack/react-query"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  findCounterparts,
  isWhitelisted,
  listWhitelisted,
  whitelistRoleOf,
  type WhitelistCounterpart,
  type WhitelistRole,
} from "@/lib/governance/whitelist"
import { canonicalTrackName } from "@/lib/governance/tracks"
import { useApi } from "./use-api"
import { useTracks } from "./use-tracks"
import { useArchiveApi } from "./use-archive-api"

/**
 * Where a referendum's call stands in the Fellowship fast track: what it
 * does (whitelists or dispatches a hash), whether the hash is whitelisted
 * now, and the referenda on the other side. Null role for any other call.
 */
export function useWhitelistLink(bytes: Uint8Array | null | undefined) {
  const chain = useActiveChain()
  const apiQuery = useApi()
  const archiveQuery = useArchiveApi()
  const tracksQuery = useTracks()
  const dispatchTrackId =
    tracksQuery.data?.find((t) => canonicalTrackName(t.name) === "whitelistedcaller")?.id ?? null
  const role: WhitelistRole | null =
    apiQuery.data && apiQuery.data.query.whitelist ? whitelistRoleOf(apiQuery.data, bytes) : null
  const hash = role?.hash ?? null
  const whitelisted = useQuery<boolean>({
    queryKey: ["whitelist", chain.id, "entry", hash],
    queryFn: () => isWhitelisted(apiQuery.data!, hash!),
    enabled: !!apiQuery.data && !!hash,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const counterparts = useQuery<WhitelistCounterpart[]>({
    queryKey: ["whitelist", chain.id, "counterparts", role?.role, hash, dispatchTrackId],
    queryFn: () =>
      findCounterparts(apiQuery.data!, archiveQuery.data ?? null, role!, dispatchTrackId),
    enabled:
      !!apiQuery.data &&
      !!role &&
      tracksQuery.isSuccess &&
      (archiveQuery.isSuccess || archiveQuery.isError),
    staleTime: 60_000,
  })
  return { role, whitelisted, counterparts }
}

/** The call hashes whitelisted right now, with what whitelisted and dispatches each. */
export function useWhitelistedCalls() {
  const chain = useActiveChain()
  const apiQuery = useApi()
  const archiveQuery = useArchiveApi()
  const tracksQuery = useTracks()
  const dispatchTrackId =
    tracksQuery.data?.find((t) => canonicalTrackName(t.name) === "whitelistedcaller")?.id ?? null
  return useQuery<
    { hash: `0x${string}`; fellowship: WhitelistCounterpart[]; dispatch: WhitelistCounterpart[] }[]
  >({
    queryKey: ["whitelist", chain.id, "all", dispatchTrackId],
    queryFn: async () => {
      const api = apiQuery.data!
      const archive = archiveQuery.data ?? null
      const hashes = await listWhitelisted(api)
      return Promise.all(
        hashes.map(async (hash) => ({
          hash,
          fellowship: await findCounterparts(api, archive, { role: "dispatch", hash, inner: null }, dispatchTrackId),
          dispatch: await findCounterparts(api, archive, { role: "whitelist", hash }, dispatchTrackId),
        })),
      )
    },
    enabled:
      !!apiQuery.data?.query.whitelist &&
      tracksQuery.isSuccess &&
      (archiveQuery.isSuccess || archiveQuery.isError),
    staleTime: 30_000,
  })
}

/** How many call hashes are whitelisted right now: one storage read. */
export function useWhitelistCount() {
  const chain = useActiveChain()
  const apiQuery = useApi()
  return useQuery<number>({
    queryKey: ["whitelist", chain.id, "count"],
    queryFn: async () => (await listWhitelisted(apiQuery.data!)).length,
    enabled: !!apiQuery.data?.query.whitelist,
    staleTime: 30_000,
  })
}

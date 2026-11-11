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
import { useDecidedTracks } from "./use-decided-tracks"
import { useReferenda } from "./use-referenda"

/**
 * The tracks of decided public referenda, from the server's cache and the
 * browser's, so the fast-track lookup only reads the archive (seconds per
 * cold read) for what neither has. Only fetched when `needed`: the archive
 * answers one read at a time, and these would hold up the page's own.
 * `ready` once both lists have settled.
 */
function usePublicDecidedTracks(needed: boolean) {
  const referendaQuery = useReferenda()
  const decided = useDecidedTracks(needed ? (referendaQuery.data ?? []) : [])
  return {
    tracks: decided.tracks,
    ready: needed && (referendaQuery.isSuccess || referendaQuery.isError) && !decided.pending,
  }
}

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
  // A dispatch's counterparts are fellowship referenda, which keep no track.
  const decided = usePublicDecidedTracks(role?.role === "whitelist")
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
      findCounterparts(
        apiQuery.data!,
        archiveQuery.data ?? null,
        role!,
        dispatchTrackId,
        decided.tracks,
      ),
    enabled:
      !!apiQuery.data &&
      !!role &&
      tracksQuery.isSuccess &&
      (role.role === "dispatch" || decided.ready) &&
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
  const count = useWhitelistCount()
  const decided = usePublicDecidedTracks((count.data ?? 0) > 0)
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
          fellowship: await findCounterparts(
            api,
            archive,
            { role: "dispatch", hash, inner: null },
            dispatchTrackId,
          ),
          dispatch: await findCounterparts(
            api,
            archive,
            { role: "whitelist", hash },
            dispatchTrackId,
            decided.tracks,
          ),
        })),
      )
    },
    enabled:
      !!apiQuery.data?.query.whitelist &&
      tracksQuery.isSuccess &&
      count.isSuccess &&
      (count.data === 0 || decided.ready) &&
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

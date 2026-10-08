"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { getDecidedTrack } from "@/lib/governance/referenda"
import type { Referendum } from "@/lib/governance/types"
import { useArchiveApi } from "./use-archive-api"

const STORAGE_PREFIX = "decided-tracks:"

/**
 * The tracks of decided referenda. Once a referendum is decided the chain
 * keeps only its outcome and deposits, not its track, so lists that filter
 * or label by track (the treasury page, proposal cards) read it from the
 * archive at the block before the decision.
 *
 * One at a time: the archive node answers a single read in a fraction of a
 * second but slows to a crawl when a page fires a dozen at once. A decided
 * referendum's track never changes, so what was read is kept in
 * localStorage and only new ones are read on the next visit.
 *
 * `pending` stays true while loading; `failed` says some couldn't be read
 * (no archive), so counts built on them would be short.
 */
export function useDecidedTracks(referenda: Referendum[], chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useArchiveApi(target)
  const decided = referenda.flatMap((r) =>
    r.trackId == null && r.status.type !== "Ongoing" && r.status.at > 1
      ? [{ index: r.index, at: r.status.at }]
      : [],
  )
  const signature = decided.map((d) => `${d.index}@${d.at}`).join(",")

  const query = useQuery({
    queryKey: ["decided-tracks", target.id, signature],
    queryFn: async () => {
      const api = apiQuery.data
      const tracks = new Map<number, number>(Object.entries(readCache(target.id)).map(([k, v]) => [Number(k), v]))
      let missing = 0
      for (const d of decided) {
        if (tracks.has(d.index)) continue
        const track = api ? await getDecidedTrack(api, d.index, d.at) : null
        if (track == null) missing++
        else tracks.set(d.index, track)
      }
      writeCache(target.id, tracks)
      return { tracks, missing }
    },
    enabled: decided.length > 0 && apiQuery.isSuccess,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  if (decided.length === 0) return { tracks: new Map<number, number>(), pending: false, failed: false }
  return {
    tracks: query.data?.tracks ?? new Map<number, number>(),
    pending: !apiQuery.isError && !query.isError && query.isPending,
    failed: apiQuery.isError || query.isError || (query.data?.missing ?? 0) > 0,
  }
}

function readCache(chainId: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + chainId)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== "object") return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, number] => Number.isInteger(e[1]) && (e[1] as number) >= 0,
      ),
    )
  } catch {
    return {}
  }
}

function writeCache(chainId: string, tracks: Map<number, number>): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + chainId, JSON.stringify(Object.fromEntries(tracks)))
  } catch {
    /* private mode or full storage - read again next time */
  }
}

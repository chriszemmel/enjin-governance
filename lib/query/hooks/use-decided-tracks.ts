"use client"

import { useQuery } from "@tanstack/react-query"
import { getApi } from "@/lib/chain/api"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { getDecidedTrack } from "@/lib/governance/referenda"
import type { Referendum } from "@/lib/governance/types"

const STORAGE_PREFIX = "decided-tracks:"

/**
 * The tracks of decided referenda. Once a referendum is decided the chain
 * keeps only its outcome and deposits, not its track, so lists that filter
 * or label by track (the treasury page, proposal cards) need it read from
 * the archive at the block before the decision.
 *
 * The server does that once for everyone and caches it
 * (`/api/chain/[chain]/decided-tracks`). Whatever it couldn't supply is
 * read here, one at a time with a few retries: the archive answers a single
 * read quickly but a cold one can take seconds, and a phone's request runs
 * into the 10 s RPC timeout. A track never changes, so what was found is
 * kept in localStorage. Anything still missing makes the query fail and
 * retry, and only then does `failed` turn the counts built on it into "-".
 */
export function useDecidedTracks(referenda: Referendum[], chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const decided = referenda.flatMap((r) =>
    r.trackId == null && r.status.type !== "Ongoing" && r.status.at > 1
      ? [{ index: r.index, at: r.status.at }]
      : [],
  )
  const signature = decided.map((d) => `${d.index}@${d.at}`).join(",")

  const query = useQuery({
    queryKey: ["decided-tracks", target.id, signature],
    queryFn: async () => {
      const tracks = new Map<number, number>(
        Object.entries(readCache(target.id)).map(([k, v]) => [Number(k), v]),
      )
      if (decided.some((d) => !tracks.has(d.index))) {
        for (const [index, track] of await fromServer(target.id)) tracks.set(index, track)
      }
      const missing = decided.filter((d) => !tracks.has(d.index))
      if (missing.length > 0) {
        const archive = await getApi(target.archiveRpc ?? target.rpc)
        for (const d of missing) {
          const track = await withRetries(() => getDecidedTrack(archive, d.index, d.at))
          if (track != null) tracks.set(d.index, track)
        }
      }
      writeCache(target.id, tracks)
      if (decided.some((d) => !tracks.has(d.index))) {
        throw new Error("Some decided referenda have no track yet")
      }
      return tracks
    },
    enabled: decided.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
    retryDelay: (attempt) => 2_000 * 2 ** attempt,
  })

  if (decided.length === 0) {
    return { tracks: new Map<number, number>(), pending: false, failed: false }
  }
  return {
    tracks: query.data ?? new Map<number, number>(),
    pending: query.isPending,
    failed: query.isError,
  }
}

/** The server's cached tracks for this chain; nothing when it can't answer. */
async function fromServer(chainId: string): Promise<Map<number, number>> {
  try {
    const res = await fetch(`/api/chain/${chainId}/decided-tracks`)
    if (!res.ok) return new Map()
    const body = (await res.json()) as { tracks?: Record<string, unknown> }
    return new Map(
      Object.entries(body.tracks ?? {}).flatMap(([k, v]) =>
        Number.isInteger(Number(k)) && Number.isInteger(v) && (v as number) >= 0
          ? [[Number(k), v as number] as [number, number]]
          : [],
      ),
    )
  } catch {
    return new Map()
  }
}

/** A read that returned nothing, tried up to three times with a short pause. */
async function withRetries(read: () => Promise<number | null>): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = await read()
    if (value != null) return value
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)))
  }
  return null
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

"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { getPreimage, getPreimageStatus } from "@/lib/governance/preimage"
import type { PreimageRef, PreimageStatus } from "@/lib/governance/types"
import { useApi } from "./use-api"

type DecodedPreimage = {
  hash: `0x${string}`
  len: number
  section: string
  method: string
  /** Human-readable arg breakdown (calls api.toHuman()). */
  args: Record<string, unknown>
  /** Stored bytes - null if the preimage is no longer noted on chain. */
  bytes: Uint8Array | null
}

/**
 * Fetch + decode a preimage by (hash, len). Returns null if the preimage
 * has been unnoted from chain state.
 */
export function usePreimage(ref: PreimageRef | null | undefined, chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<DecodedPreimage | null>({
    queryKey: ["preimage", target.id, ref?.hash, ref?.len],
    queryFn: async () => {
      if (!apiQuery.data || !ref) return null
      const api = apiQuery.data
      const preimage = await getPreimage(api, ref)
      if (!preimage?.bytes) {
        return { hash: ref.hash, len: ref.len, section: "", method: "", args: {}, bytes: null }
      }
      const call = api.createType("Call", preimage.bytes)
      const json = call.toHuman() as { section?: string; method?: string; args?: unknown }
      return {
        hash: ref.hash,
        len: ref.len,
        section: (call as unknown as { section: string }).section ?? json.section ?? "",
        method: (call as unknown as { method: string }).method ?? json.method ?? "",
        args: (json.args as Record<string, unknown>) ?? {},
        bytes: preimage.bytes,
      }
    },
    enabled: apiQuery.isSuccess && !!ref,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
  })
}

/**
 * Lightweight check: is this preimage already noted on chain?
 * Used by the create wizard so it can omit `preimage.notePreimage`
 * from the batch when an earlier proposal already noted the same
 * call bytes (`preimage.AlreadyNoted` would otherwise abort the
 * batchAll).
 */
export function usePreimageStatus(
  hash: `0x${string}` | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  return useQuery<PreimageStatus>({
    queryKey: ["preimage-status", target.id, hash],
    queryFn: async () => {
      if (!apiQuery.data || !hash) return "Missing"
      return getPreimageStatus(apiQuery.data, hash)
    },
    enabled: apiQuery.isSuccess && !!hash,
    staleTime: 30_000,
  })
}

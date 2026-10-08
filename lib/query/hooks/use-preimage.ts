"use client"

import { useQuery } from "@tanstack/react-query"
import type { Registry } from "@polkadot/types/types"
import { u8aToHex } from "@polkadot/util"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { getPreimage, getPreimageStatus, hashCall } from "@/lib/governance/preimage"
import type { PreimageRef, PreimageStatus } from "@/lib/governance/types"
import { useApi } from "./use-api"
import { useArchiveApi } from "./use-archive-api"

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
      return {
        hash: ref.hash,
        len: ref.len,
        ...decodeCall(api.registry, preimage.bytes),
        bytes: preimage.bytes,
      }
    },
    enabled: apiQuery.isSuccess && !!ref,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
  })
}

/**
 * Decode a call that rides inline in its referendum (`Bounded::Inline`).
 * There's no preimage to fetch - the bytes live in the referendum info - so
 * this only decodes. Same shape as `usePreimage` so both render alike; the
 * hash is the call's blake2-256, as the chain would key a noted preimage.
 *
 * `atBlock` is the block the bytes were read at when they come from a decided
 * referendum's history. They're decoded with that block's runtime: a later
 * upgrade can re-index or reshape calls, so today's metadata could misread
 * them as a different call. Omit it for a live referendum.
 */
export function useInlineCall(
  bytes: Uint8Array | null | undefined,
  atBlock?: number | null,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const liveApi = useApi(target)
  // History comes from the archive endpoint, so its old runtimes do too.
  const archiveApi = useArchiveApi(target)
  const apiQuery = atBlock != null ? archiveApi : liveApi
  return useQuery<DecodedPreimage | null>({
    queryKey: ["inline-call", target.id, atBlock ?? null, bytes ? u8aToHex(bytes) : null],
    queryFn: async () => {
      const api = apiQuery.data
      if (!api || !bytes) return null
      const registry =
        atBlock != null
          ? (await api.at(await api.rpc.chain.getBlockHash(atBlock))).registry
          : api.registry
      return {
        hash: hashCall(bytes),
        len: bytes.length,
        ...decodeCall(registry, bytes),
        bytes,
      }
    },
    enabled: apiQuery.isSuccess && !!bytes,
    staleTime: Infinity,
  })
}

function decodeCall(
  registry: Registry,
  bytes: Uint8Array,
): Pick<DecodedPreimage, "section" | "method" | "args"> {
  const call = registry.createType("Call", bytes)
  const json = call.toHuman() as { section?: string; method?: string; args?: unknown }
  return {
    section: (call as unknown as { section: string }).section ?? json.section ?? "",
    method: (call as unknown as { method: string }).method ?? json.method ?? "",
    args: (json.args as Record<string, unknown>) ?? {},
  }
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

"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { useApi } from "./use-api"

/** How often the in-memory runtime version is re-read. No network involved. */
const SPEC_POLL_MS = 15_000

/**
 * The connected runtime's spec version, or null until the API connects.
 *
 * polkadot.js already subscribes to `state_subscribeRuntimeVersion`; on an
 * upgrade it fetches the new metadata, re-decorates `api.consts` and only
 * then updates `api.runtimeVersion`. So reading `api.runtimeVersion` is free
 * and never runs ahead of the constants. Polling it lets every cache that
 * depends on runtime constants (tracks, spend tiers, the support
 * denominator, treasury constants) put the spec in its query key and
 * refresh when an open tab sees an upgrade.
 */
export function useSpecVersion(chain?: ChainConfig): number | null {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const api = apiQuery.data
  const query = useQuery<number>({
    queryKey: ["spec-version", target.rpc],
    queryFn: () => {
      if (!api) throw new Error("API not ready")
      return api.runtimeVersion.specVersion.toNumber()
    },
    enabled: apiQuery.isSuccess,
    staleTime: 0,
    refetchInterval: SPEC_POLL_MS,
  })
  return query.data ?? null
}

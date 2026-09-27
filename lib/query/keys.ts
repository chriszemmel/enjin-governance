/**
 * Query key factory for the shared chain queries, so they can be
 * invalidated by prefix without typos. Some feature hooks keep their own
 * inline keys.
 *
 *   queryClient.invalidateQueries({ queryKey: queryKeys.referenda.all('enjin-relay') })
 */

import type { ChainId } from "@/lib/chain/chains"
import type { ReferendumFilter } from "@/lib/governance/referenda"

export const queryKeys = {
  /** Cached ApiPromise per endpoint. */
  api: (endpoint: string) => ["api", endpoint] as const,

  referenda: {
    /** Prefix - invalidates every referenda query on a chain. */
    all: (chain: ChainId) => ["referenda", chain] as const,
    list: (chain: ChainId, filter?: ReferendumFilter) =>
      ["referenda", chain, "list", filter ?? {}] as const,
    detail: (chain: ChainId, index: number) =>
      ["referenda", chain, "detail", index] as const,
    count: (chain: ChainId) => ["referenda", chain, "count"] as const,
  },

  tracks: (chain: ChainId) => ["tracks", chain] as const,
} as const

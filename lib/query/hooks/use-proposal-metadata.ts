"use client"

import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"

/**
 * Off-chain proposal metadata for a referendum, fetched from our Neon
 * mirror via /api/proposals/by-index. Returns null (no error) when the
 * referendum was filed before this system shipped - the detail page
 * gracefully degrades to the on-chain-only view in that case.
 */

export type ProposalMetadata = {
  id: string
  network: string
  referendum_index: number
  title: string
  summary: string | null
  body_markdown: string
  track: string | null
  beneficiary: string | null
  amount_planck: string | null
  proposer_address: string
  json_url: string
  json_sha256: string
  status: string
  edited_at: string | null
  edit_count: number
  withdrawn_at: string | null
  withdrawn_reason: string | null
  created_at: string
}

export function useProposalMetadata(index: number | null, chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  return useQuery<ProposalMetadata | null>({
    queryKey: ["proposal-metadata", target.id, index],
    queryFn: async () => {
      if (index == null) return null
      // no-store so an edit/withdraw lands on the next refetch even
      // if a stale CDN/browser cache entry would otherwise serve it.
      const res = await fetch(
        `/api/proposals/by-index/${index}?network=${target.id}`,
        { cache: "no-store" },
      )
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { ok: true } & ProposalMetadata
      return json
    },
    enabled: index != null,
    // Short staleTime keeps the (edited) chip / withdrawn banner in
    // sync without spamming the API. React Query's invalidation in
    // useEditProposal / useWithdrawProposal forces an immediate
    // refetch the moment a mutation lands.
    staleTime: 15_000,
    gcTime: 600_000,
  })
}

/**
 * Batch sibling to `useProposalMetadata`. One POST returns metadata for
 * every index in the list - used by list pages that would otherwise fan
 * out into N requests (home featured grid, /proposals, /treasury).
 *
 * Side-effect: primes the per-index `["proposal-metadata", chain, idx]`
 * cache so navigating into a detail page is an instant hit.
 *
 * Returns a `Map<index, ProposalMetadata | null>` for the indices that
 * were actually requested - `null` means the row doesn't exist (referendum
 * was filed before this system shipped). Loading state is the standard
 * React Query `isPending`.
 */
export function useProposalMetadataBatch(
  indices: ReadonlyArray<number>,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const qc = useQueryClient()

  const unique = useMemo(() => {
    const set = new Set<number>()
    for (const i of indices) {
      if (Number.isInteger(i) && i >= 0) set.add(i)
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [indices])

  const cacheKey = unique.join(",")

  return useQuery<Map<number, ProposalMetadata | null>>({
    queryKey: ["proposal-metadata-batch", target.id, cacheKey],
    queryFn: async () => {
      const result = new Map<number, ProposalMetadata | null>()
      if (unique.length === 0) return result
      const res = await fetch("/api/proposals/by-indices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: target.id, indices: unique }),
        cache: "no-store",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as {
        ok: true
        proposals: ProposalMetadata[]
      }
      const byIndex = new Map<number, ProposalMetadata>()
      for (const p of json.proposals) byIndex.set(p.referendum_index, p)
      for (const i of unique) {
        const m = byIndex.get(i) ?? null
        result.set(i, m)
        qc.setQueryData(["proposal-metadata", target.id, i], m)
      }
      return result
    },
    enabled: unique.length > 0,
    staleTime: 15_000,
    gcTime: 600_000,
  })
}

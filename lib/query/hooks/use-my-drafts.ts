"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"

export type MyDraftStatus =
  | "draft"
  | "submitted"
  | "on_chain"
  | "failed"
  | "cancelled"

export type MyDraft = {
  id: string
  title: string
  status: MyDraftStatus
  referendum_index: number | null
  tx_hash: string | null
  json_url: string
  created_at: string
  /** False for advanced-composer drafts, which /create can't resume. */
  has_spend: boolean
}

/**
 * Lists every proposal row authored by the connected address on the
 * active chain. Used by the wizard to surface old un-landed drafts so
 * the proposer can mark them outdated.
 */
export function useMyDrafts(address: string | null, chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  return useQuery<MyDraft[]>({
    queryKey: ["my-drafts", target.id, address],
    queryFn: async () => {
      if (!address) return []
      const res = await fetch(
        `/api/proposals/by-proposer/${address}?network=${target.id}`,
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { ok: true; items: MyDraft[] }
      return json.items
    },
    enabled: !!address,
    staleTime: 30_000,
  })
}

export function useCancelDraft() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; reason?: string }>({
    mutationFn: async ({ id, reason }) => {
      const res = await fetch(`/api/proposals/${id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-drafts"] })
    },
  })
}

export function useDeleteDraft() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-drafts"] })
    },
  })
}

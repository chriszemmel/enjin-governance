"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

type Args = {
  id: string
  reason?: string | null
  undo?: boolean
}

type Result = {
  id: string
  withdrawn_at: string | null
  withdrawn_reason: string | null
}

/**
 * Toggle the off-chain "proposer withdrew this" flag. The on-chain
 * referendum is untouched - voting stays open, the chain state is the
 * same. Refreshes the metadata cache so the detail page picks up the
 * banner (or removes it on undo).
 */
export function useWithdrawProposal() {
  const qc = useQueryClient()
  return useMutation<Result, Error, Args>({
    mutationFn: async ({ id, reason, undo }) => {
      const res = await fetch(`/api/proposals/${id}/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: reason ?? undefined,
          undo: undo ?? undefined,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        let message = text
        try {
          const parsed = JSON.parse(text) as { error?: string }
          if (parsed.error) message = parsed.error
        } catch {
          // not JSON
        }
        throw new Error(message || `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { ok: true } & Result
      return json
    },
    onSuccess: () => {
      // Force the detail page to drop straight to the new state -
      // banner appears / clears immediately rather than waiting for
      // the next staleTime window.
      void qc.refetchQueries({ queryKey: ["proposal-metadata"] })
      void qc.invalidateQueries({ queryKey: ["my-drafts"] })
    },
  })
}

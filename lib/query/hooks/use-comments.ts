"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

export type Comment = {
  id: string
  proposal_id: string
  parent_id: string | null
  user_id: string
  author_address: string
  author_handle: string | null
  author_display_name: string | null
  author_avatar_url: string | null
  author_is_verified: boolean
  body_markdown: string
  is_deleted: boolean
  edited_at: string | null
  created_at: string
}

export function useComments(proposalUuid: string | null | undefined) {
  return useQuery<Comment[]>({
    queryKey: ["comments", proposalUuid],
    queryFn: async () => {
      if (!proposalUuid) return []
      const res = await fetch(`/api/proposals/${proposalUuid}/comments`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { ok: true; items: Comment[] }
      return json.items
    },
    enabled: !!proposalUuid,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useCreateComment(proposalUuid: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<Comment, Error, { body_markdown: string; parent_id?: string | null }>({
    mutationFn: async ({ body_markdown, parent_id }) => {
      if (!proposalUuid) throw new Error("No proposal id")
      const res = await fetch(`/api/proposals/${proposalUuid}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body_markdown, parent_id: parent_id ?? null }),
      })
      const json = (await res.json()) as
        | { ok: true; comment: Comment }
        | { ok: false; error: string }
      if (!("ok" in json) || !json.ok) {
        throw new Error("error" in json ? json.error : `HTTP ${res.status}`)
      }
      return json.comment
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["comments", proposalUuid] })
    },
  })
}

export function useDeleteComment(proposalUuid: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (commentId) => {
      const res = await fetch(`/api/comments/${commentId}`, { method: "DELETE" })
      if (!res.ok) {
        const text = await res.text()
        let message = text || `HTTP ${res.status}`
        try {
          const parsed = JSON.parse(text) as { error?: string }
          if (parsed?.error) message = parsed.error
        } catch {
          // not JSON - fall through with raw text
        }
        throw new Error(message)
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["comments", proposalUuid] })
    },
  })
}

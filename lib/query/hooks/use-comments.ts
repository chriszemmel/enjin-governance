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
  /** The author can edit the comment until then (15 minutes after posting). */
  editable_until: string
  created_at: string
  /** Set when moderators blurred or hid the comment. */
  moderation?: { state: "visible" | "blurred" | "hidden" | "removed"; reason: string | null } | null
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

/** The route's `error` text; a generic line for anything else (e.g. an HTML error page). */
async function errorFrom(res: Response): Promise<Error> {
  let message = `Something went wrong (HTTP ${res.status}) - try again.`
  try {
    const parsed = JSON.parse(await res.text()) as { error?: string }
    if (parsed?.error) message = parsed.error
  } catch {
    // not JSON - keep the generic line
  }
  return new Error(message)
}

export function useEditComment(proposalUuid: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<Comment, Error, { id: string; body_markdown: string }>({
    mutationFn: async ({ id, body_markdown }) => {
      const res = await fetch(`/api/comments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body_markdown }),
      })
      if (!res.ok) throw await errorFrom(res)
      const json = (await res.json()) as { ok: true; comment: Comment }
      return json.comment
    },
    onSuccess: (updated) => {
      // Show the new text right away rather than the old one until the refetch.
      qc.setQueryData<Comment[]>(["comments", proposalUuid], (list) =>
        list?.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
      )
      void qc.invalidateQueries({ queryKey: ["comments", proposalUuid] })
    },
  })
}

export function useDeleteComment(proposalUuid: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (commentId) => {
      const res = await fetch(`/api/comments/${commentId}`, { method: "DELETE" })
      if (!res.ok) throw await errorFrom(res)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["comments", proposalUuid] })
    },
  })
}

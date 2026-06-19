"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UploadedAttachment } from "@/components/create/attachment-dropzone"

type EditProposalArgs = {
  id: string
  title: string
  summary: string | null
  body_markdown: string
  attachments: UploadedAttachment[]
}

type EditProposalResult = {
  id: string
  json_url: string
  json_sha256: string
  edited_at: string
  edit_count: number
}

/**
 * Apply a proposer-driven edit to an on-chain proposal's off-chain
 * narrative. Routes through `PATCH /api/proposals/[id]` which re-uploads
 * the canonical JSON in R2 and bumps the row's edit counters.
 *
 * On success, invalidates the metadata + JSON queries for the proposal
 * so the detail page picks up the new content + the "(edited)" chip.
 */
export function useEditProposal() {
  const qc = useQueryClient()
  return useMutation<EditProposalResult, Error, EditProposalArgs>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/proposals/${input.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          summary: input.summary,
          body_markdown: input.body_markdown,
          attachments: input.attachments.map((a) => ({
            bucket_key: a.bucket_key,
            name: a.name,
            url: a.url,
            sha256: a.sha256,
            content_type: a.content_type,
            size_bytes: a.size_bytes,
          })),
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
      const json = (await res.json()) as { ok: true } & EditProposalResult
      return json
    },
    onSuccess: () => {
      // refetchQueries forces an immediate network round-trip on every
      // active observer (the detail page's metadata header + the
      // About card) so the title, (edited) chip, and rendered body
      // update without waiting for the staleTime window to roll over.
      void qc.refetchQueries({ queryKey: ["proposal-metadata"] })
      void qc.refetchQueries({ queryKey: ["proposal-json"] })
      void qc.invalidateQueries({ queryKey: ["my-drafts"] })
    },
  })
}

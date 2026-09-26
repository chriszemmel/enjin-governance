"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Eye } from "lucide-react"
import type { UploadedAttachment } from "@/components/create/attachment-dropzone"
import { ProposalBody } from "@/components/governance/proposal-body"
import { resolveProposalMedia } from "@/lib/governance/proposal-media"

/**
 * The proposal exactly as the proposal page will show it: same title and
 * summary styling, same body renderer, same gallery. Long proposals are
 * folded so the signing steps below stay in reach.
 */
export function VoterPreview({
  title,
  summary,
  body,
  attachments,
  network,
  proposalId,
}: {
  title: string
  summary: string
  body: string
  attachments: readonly UploadedAttachment[]
  network: string
  proposalId: string
}) {
  const media = useMemo(
    () => resolveProposalMedia(attachments, network, proposalId),
    [attachments, network, proposalId],
  )
  const long = body.length > 1500 || media.some((m) => m.isImage)
  const [expanded, setExpanded] = useState(false)
  const folded = long && !expanded

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-border">
        <Eye className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Preview as voters will see it</h2>
      </div>
      <div className={folded ? "relative max-h-[520px] overflow-hidden" : undefined}>
        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-foreground leading-tight [overflow-wrap:anywhere]">
              {title}
            </h3>
            {summary && (
              <p className="text-sm text-muted-foreground leading-relaxed [overflow-wrap:anywhere]">
                {summary}
              </p>
            )}
          </div>
          <div className="pt-4 border-t border-border space-y-4">
            <ProposalBody body={body} media={media} />
          </div>
        </div>
        {folded && (
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card to-transparent pointer-events-none" />
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center justify-center gap-1 border-t border-border py-2.5 text-xs font-medium text-primary hover:bg-surface-1"
        >
          {expanded ? "Show less" : "Show the full proposal"}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}
    </div>
  )
}

"use client"

import { useState } from "react"
import { AttachmentGallery, ImageLightbox } from "@/components/governance/attachment-gallery"
import { MarkdownView } from "@/components/governance/markdown-view"
import type { ProposalMedia } from "@/lib/governance/proposal-media"

/**
 * Proposal text plus its attachment gallery, sharing one image viewer.
 * The proposal page, the Preview tab and the Review step all render
 * through this, so proposers see exactly what voters will.
 */
export function ProposalBody({
  body,
  media,
  showGallery = true,
}: {
  body: string
  media: readonly ProposalMedia[]
  showGallery?: boolean
}) {
  const [viewing, setViewing] = useState<ProposalMedia | null>(null)
  const images = media.filter((m) => m.isImage)
  return (
    <>
      {body.trim() && (
        <div className="text-foreground">
          <MarkdownView source={body} media={media} onOpenImage={setViewing} />
        </div>
      )}
      {showGallery && <AttachmentGallery media={media} onOpenImage={setViewing} />}
      <ImageLightbox images={images} current={viewing} onChange={setViewing} />
    </>
  )
}

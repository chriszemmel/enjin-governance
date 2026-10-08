"use client"

import { useState } from "react"
import { AttachmentGallery, ImageLightbox } from "@/components/governance/attachment-gallery"
import { MarkdownView } from "@/components/governance/markdown-view"
import { isWithheld } from "@/components/moderation/moderation-notes"
import type { ProposalMedia } from "@/lib/governance/proposal-media"
import type { ModerationInfo } from "@/lib/query/hooks/use-moderation"

/**
 * Proposal text plus its attachment gallery, sharing one image viewer.
 * The proposal page, the Preview tab and the Review step all render
 * through this, so proposers see exactly what voters will.
 */
export function ProposalBody({
  body,
  media,
  showGallery = true,
  moderation = {},
  onReportImage,
}: {
  body: string
  media: readonly ProposalMedia[]
  showGallery?: boolean
  /** Moderation state per attachment key (proposal page only). */
  moderation?: Readonly<Record<string, ModerationInfo>>
  onReportImage?: (m: ProposalMedia) => void
}) {
  const [viewing, setViewing] = useState<ProposalMedia | null>(null)
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const reveal = (key: string) => setRevealed((r) => new Set(r).add(key))
  // The viewer only pages through images the reader can see right now.
  const images = media.filter(
    (m) =>
      m.isImage &&
      !isWithheld(moderation[m.key]) &&
      (moderation[m.key]?.state !== "blurred" || revealed.has(m.key)),
  )
  const shared = { moderation, revealed, onReveal: reveal }
  return (
    <>
      {body.trim() && (
        <div className="text-foreground">
          <MarkdownView source={body} media={media} onOpenImage={setViewing} {...shared} />
        </div>
      )}
      {showGallery && <AttachmentGallery media={media} onOpenImage={setViewing} {...shared} />}
      <ImageLightbox
        images={images}
        current={viewing}
        onChange={setViewing}
        onReport={onReportImage}
      />
    </>
  )
}

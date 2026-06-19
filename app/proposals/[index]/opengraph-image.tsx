import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "edge"
export const alt = "Enjin Governance · Referendum"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

type Props = { params: { index: string } }

export default function Image({ params }: Props) {
  const index = Number(params.index)
  const display = Number.isFinite(index) ? `#${index}` : params.index
  return renderOgImage({
    eyebrow: "Enjin Governance · Referendum",
    title: `Referendum ${display}`,
    subtitle:
      "Live tally, voter list, conviction breakdown, and the EGOV1 narrative pinned by the on-chain system.remark.",
  })
}

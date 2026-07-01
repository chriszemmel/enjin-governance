import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "edge"
export const alt = "Enjin Governance · Referendum"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

type Props = { params: Promise<{ index: string }> }

export default async function Image({ params }: Props) {
  const { index: rawIndex } = await params
  const index = Number(rawIndex)
  const display = Number.isFinite(index) ? `#${index}` : rawIndex
  return renderOgImage({
    eyebrow: "Enjin Governance · Referendum",
    title: `Referendum ${display}`,
    subtitle:
      "Live tally, voter list, conviction breakdown, and the EGOV1 narrative pinned by the on-chain system.remark.",
  })
}

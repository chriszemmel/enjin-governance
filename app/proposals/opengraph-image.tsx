import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "nodejs"
export const alt = "Enjin Governance · Proposals"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    section: "Proposals",
    title: "Every referendum, live from the chain.",
    tagline: "Read, discuss and vote",
  })
}

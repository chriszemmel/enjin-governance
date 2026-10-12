import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "nodejs"
export const alt = "Enjin Governance"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    title: "Shape the future of Enjin.",
    tagline: "Vote, propose and follow the treasury",
  })
}

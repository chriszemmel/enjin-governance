import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "nodejs"
export const alt = "Enjin Governance · Treasury"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    section: "Treasury",
    title: "The Enjin Treasury, on chain.",
    tagline: "Balance, spends and requests",
  })
}

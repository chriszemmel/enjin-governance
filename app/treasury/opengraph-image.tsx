import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "edge"
export const alt = "Enjin Governance · Treasury"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    eyebrow: "Enjin Governance · Treasury",
    title: "The Enjin Treasury, on chain.",
    subtitle:
      "Track the relay treasury balance, pending spends, and approved disbursements. File a treasury request from the same surface.",
  })
}

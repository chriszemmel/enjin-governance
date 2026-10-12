import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "nodejs"
export const alt = "Enjin Governance · Preview access"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    section: "Preview",
    title: "This preview is password-protected.",
    tagline: "Enter the access password to continue",
  })
}

import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "edge"
export const alt = "Enjin Governance · Preview access"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    eyebrow: "Enjin Governance · Preview",
    title: "This preview is password-protected.",
    subtitle: "Enter the access password to continue to the governance client.",
  })
}

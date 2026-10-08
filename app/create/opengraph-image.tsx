import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "nodejs"
export const alt = "Enjin Governance · File a Proposal"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    section: "Create",
    title: "File a Proposal in one click.",
    tagline: "Treasury spends and any other call",
  })
}

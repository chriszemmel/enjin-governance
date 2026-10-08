import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "nodejs"
export const alt = "Enjin Governance · Docs"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    section: "Docs",
    title: "EGOV1 and the governance client, explained.",
    tagline: "Tracks, deposits, voting and EGOV1",
  })
}

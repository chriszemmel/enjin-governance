import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "edge"
export const alt = "Enjin Governance · Docs"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    eyebrow: "Enjin Governance · Docs",
    title: "EGOV1 and the governance client, explained.",
    subtitle:
      "The metadata standard, the chain flow, the voting primitives, and integration notes for indexers and wallets.",
  })
}

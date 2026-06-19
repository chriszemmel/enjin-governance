import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "edge"
export const alt = "Enjin Governance · Unlock"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    eyebrow: "Enjin Governance · Unlock",
    title: "Reclaim your locked stake.",
    subtitle:
      "Clear conviction locks the moment their referendum resolves. Your ENJ goes straight back to free balance.",
  })
}

import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "edge"
export const alt = "Enjin Governance"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    title: "Shape the future of Enjin.",
    subtitle:
      "On-chain governance for the Enjin Relaychain. Browse referenda, cast conviction votes, and submit treasury requests in one place.",
  })
}

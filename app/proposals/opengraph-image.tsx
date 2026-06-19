import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "edge"
export const alt = "Enjin Governance · Proposals"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    eyebrow: "Enjin Governance · Proposals",
    title: "Every referendum, live from the chain.",
    subtitle:
      "Tally, voters, conviction locks, decision deposits. Read directly from the Enjin Relaychain RPC. No connecting required to browse.",
  })
}

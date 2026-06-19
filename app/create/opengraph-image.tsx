import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og/render"

export const runtime = "edge"
export const alt = "Enjin Governance · File a Proposal"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({
    eyebrow: "Enjin Governance · Create",
    title: "File a Proposal in one click.",
    subtitle:
      "Compose your spend, batch the preimage, submit, and anchor EGOV1 metadata in a single atomic extrinsic.",
  })
}

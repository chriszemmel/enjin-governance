import { describe, expect, it } from "vitest"
import {
  findProposalImage,
  markdownForAttachment,
  resolveProposalMedia,
} from "@/lib/governance/proposal-media"

const NET = "canary-relay"
const ID = "11111111-2222-4333-8444-555555555555"
const OTHER = "99999999-2222-4333-8444-555555555555"
const own = (name: string) => `https://gov.example/r/proposals/${NET}/${ID}/media/${name}`

const att = (url: string, name: string, content_type = "image/png") => ({
  url,
  name,
  content_type,
  sha256: "a".repeat(64),
  size_bytes: 1024,
})

describe("resolveProposalMedia", () => {
  it("loads own files through the app's /r route", () => {
    const [m] = resolveProposalMedia([att(own("ab12cd34-roadmap.png"), "roadmap.png")], NET, ID)
    expect(m).toMatchObject({
      key: `proposals/${NET}/${ID}/media/ab12cd34-roadmap.png`,
      src: `/r/proposals/${NET}/${ID}/media/ab12cd34-roadmap.png`,
      thumbSrc: `/r/proposals/${NET}/${ID}/media/ab12cd34-roadmap.png.thumb.webp`,
      isImage: true,
    })
  })

  it("accepts older direct bucket URLs for the same key", () => {
    const url = `https://pub-123.r2.dev/proposals/${NET}/${ID}/media/old.png`
    expect(resolveProposalMedia([att(url, "old.png")], NET, ID)).toHaveLength(1)
  })

  it("drops files of other proposals and external URLs", () => {
    const list = [
      att(`https://gov.example/r/proposals/${NET}/${OTHER}/media/x.png`, "x.png"),
      att("https://tracker.example/pixel.png", "pixel.png"),
      att(`https://gov.example/r/proposals/${NET}/${ID}/proposal.json`, "proposal.json"),
    ]
    expect(resolveProposalMedia(list, NET, ID)).toEqual([])
  })

  it("marks PDFs as files without a thumbnail", () => {
    const [m] = resolveProposalMedia([att(own("budget.pdf"), "budget.pdf", "application/pdf")], NET, ID)
    expect(m).toMatchObject({ isImage: false, thumbSrc: null })
  })
})

describe("findProposalImage", () => {
  const media = resolveProposalMedia(
    [
      att(own("ab12cd34-roadmap.png"), "roadmap.png"),
      att(own("ef56ab78-budget.pdf"), "budget.pdf", "application/pdf"),
    ],
    NET,
    ID,
  )

  it("finds an image by URL, by /r path or by file name", () => {
    expect(findProposalImage(media, own("ab12cd34-roadmap.png"))?.name).toBe("roadmap.png")
    expect(findProposalImage(media, `/r/proposals/${NET}/${ID}/media/ab12cd34-roadmap.png`)?.name).toBe(
      "roadmap.png",
    )
    expect(findProposalImage(media, "roadmap.png")?.name).toBe("roadmap.png")
  })

  it("never resolves external images or non-images", () => {
    expect(findProposalImage(media, "https://tracker.example/pixel.png")).toBeNull()
    expect(findProposalImage(media, "budget.pdf")).toBeNull()
    expect(findProposalImage(media, "")).toBeNull()
  })
})

describe("markdownForAttachment", () => {
  it("writes images as images and files as links", () => {
    expect(markdownForAttachment(att("https://g/r/a.png", "a [1].png"))).toBe("![a 1.png](https://g/r/a.png)")
    expect(markdownForAttachment(att("https://g/r/b.pdf", "b.pdf", "application/pdf"))).toBe(
      "[b.pdf](https://g/r/b.pdf)",
    )
  })
})

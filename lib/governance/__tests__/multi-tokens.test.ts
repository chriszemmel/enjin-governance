import { describe, expect, it } from "vitest"
import {
  buildTokenMetadataUrl,
  normaliseTokenMetadata,
} from "@/lib/governance/multi-tokens"

describe("buildTokenMetadataUrl", () => {
  it("substitutes {id} with <collection>-<token>", () => {
    expect(
      buildTokenMetadataUrl(
        "https://platform.production.enjinusercontent.com/enterprise/degens/assets/metadata/{id}.json",
        2n,
        512n,
      ),
    ).toBe(
      "https://platform.production.enjinusercontent.com/enterprise/degens/assets/metadata/2-512.json",
    )
  })

  it("replaces every occurrence of {id}", () => {
    expect(
      buildTokenMetadataUrl("https://cdn/{id}/img/{id}.png", 7n, 1n),
    ).toBe("https://cdn/7-1/img/7-1.png")
  })

  it("handles large token ids safely (bigint)", () => {
    expect(
      buildTokenMetadataUrl("https://cdn/{id}.json", 1n, 999_999_999_999n),
    ).toBe("https://cdn/1-999999999999.json")
  })
})

describe("normaliseTokenMetadata", () => {
  it("prefers fallback_image over media[0] over image", () => {
    const m = normaliseTokenMetadata({
      name: "Degen #512",
      description: "",
      fallback_image: "https://cdn/512.png",
      media: [{ url: "https://cdn/alt.png", type: "image/png" }],
      image: "https://cdn/other.png",
    })
    expect(m.name).toBe("Degen #512")
    expect(m.image).toBe("https://cdn/512.png")
  })

  it("falls back to media[0].url when no fallback_image", () => {
    const m = normaliseTokenMetadata({
      name: "Pool NFT",
      media: [{ url: "https://cdn/from-media.png", type: "image/png" }],
    })
    expect(m.image).toBe("https://cdn/from-media.png")
  })

  it("falls back to image field when no fallback_image or media", () => {
    const m = normaliseTokenMetadata({ name: "Plain", image: "https://cdn/plain.png" })
    expect(m.image).toBe("https://cdn/plain.png")
  })

  it("returns null image when nothing present", () => {
    expect(normaliseTokenMetadata({ name: "Bare" }).image).toBeNull()
  })

  it("returns null for absent string fields", () => {
    const m = normaliseTokenMetadata({})
    expect(m.name).toBeNull()
    expect(m.description).toBeNull()
    expect(m.externalUrl).toBeNull()
    expect(m.image).toBeNull()
  })

  it("ignores non-string fields gracefully", () => {
    const m = normaliseTokenMetadata({
      name: 123,
      fallback_image: { not: "a string" },
      external_url: ["arr"],
    } as unknown as Record<string, unknown>)
    expect(m.name).toBeNull()
    expect(m.image).toBeNull()
    expect(m.externalUrl).toBeNull()
  })
})

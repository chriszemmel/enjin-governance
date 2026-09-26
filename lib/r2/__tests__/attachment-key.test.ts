import { describe, expect, it } from "vitest"
import {
  keyFromPublicUrl,
  ownMediaKey,
  proposalJsonKey,
  proposalMediaKey,
  proposalPrefix,
  uniqueMediaName,
} from "@/lib/r2/paths"

const NET = "enjin-relay"
const ID = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"

describe("proposalPrefix", () => {
  it("contains the proposal's own JSON key", () => {
    expect(proposalJsonKey(NET, ID).startsWith(proposalPrefix(NET, ID))).toBe(true)
  })
})

describe("ownMediaKey", () => {
  it("accepts a key in the proposal's own media folder", () => {
    const key = `proposals/${NET}/${ID}/media/roadmap.png`
    expect(ownMediaKey(key, NET, ID)).toBe(key)
  })

  it("strips the /r read-route segment the edit page leaves on app-origin URLs", () => {
    expect(ownMediaKey(`r/proposals/${NET}/${ID}/media/roadmap.png`, NET, ID)).toBe(
      `proposals/${NET}/${ID}/media/roadmap.png`,
    )
  })

  it("rejects another proposal's JSON and media", () => {
    expect(ownMediaKey(proposalJsonKey(NET, OTHER), NET, ID)).toBeNull()
    expect(ownMediaKey(`proposals/${NET}/${OTHER}/media/a.png`, NET, ID)).toBeNull()
  })

  it("rejects this proposal's own JSON (not an attachment)", () => {
    expect(ownMediaKey(proposalJsonKey(NET, ID), NET, ID)).toBeNull()
  })

  it("rejects avatars, index files and other networks", () => {
    expect(ownMediaKey("user-avatars/abc.png", NET, ID)).toBeNull()
    expect(ownMediaKey(`proposals/${NET}/index/42.json`, NET, ID)).toBeNull()
    expect(ownMediaKey(`proposals/canary-relay/${ID}/media/a.png`, NET, ID)).toBeNull()
  })

  it("keeps ordinary filenames that contain double dots", () => {
    const key = `proposals/${NET}/${ID}/media/budget..final.pdf`
    expect(ownMediaKey(key, NET, ID)).toBe(key)
  })

  it("rejects traversal, empty names and odd separators", () => {
    expect(ownMediaKey(`proposals/${NET}/${ID}/media/../../${OTHER}/proposal.json`, NET, ID)).toBeNull()
    expect(ownMediaKey(`proposals/${NET}/${ID}/media/`, NET, ID)).toBeNull()
    expect(ownMediaKey(`proposals/${NET}/${ID}/media//a.png`, NET, ID)).toBeNull()
    expect(ownMediaKey(`proposals/${NET}/${ID}/media\\a.png`, NET, ID)).toBeNull()
    expect(ownMediaKey(`proposals/${NET}/${ID}/media/./a.png`, NET, ID)).toBeNull()
    expect(ownMediaKey(`proposals/${NET}/${ID}/media/..`, NET, ID)).toBeNull()
  })

  it("rejects names outside the sanitised filename charset", () => {
    for (const name of ["a b.png", "a%2fb.png", "..%2f..%2fx.json", "a\u0000.png", "ä.png", "a\nb.png", "a".repeat(121)]) {
      expect(ownMediaKey(`proposals/${NET}/${ID}/media/${name}`, NET, ID)).toBeNull()
    }
  })
})

describe("keyFromPublicUrl", () => {
  const key = `proposals/${NET}/${ID}/media/roadmap.png`
  it("handles app-origin /r URLs and bucket URLs", () => {
    expect(keyFromPublicUrl(`https://gov.enjin.cloud/r/${key}`)).toBe(key)
    expect(keyFromPublicUrl(`https://pub-abc.r2.dev/${key}`)).toBe(key)
  })
  it("returns the input unchanged when it isn't a URL", () => {
    expect(keyFromPublicUrl(key)).toBe(key)
  })
})

describe("uniqueMediaName", () => {
  it("prefixes the sanitised name so same-name uploads don't collide", () => {
    expect(uniqueMediaName("My Photo (1).JPG", "ab12cd34")).toBe("ab12cd34-My_Photo_1_.JPG")
    expect(uniqueMediaName("image.png", "ab12cd34")).not.toBe(uniqueMediaName("image.png", "ef56ab78"))
  })

  it("never produces a name that looks like another file's thumbnail", () => {
    expect(uniqueMediaName("seed.thumb.webp", "ab12cd34")).toBe("ab12cd34-seed-thumb.webp")
  })

  it("falls back to 'file' and stays a valid media key with room for a thumbnail", () => {
    expect(uniqueMediaName("???", "ab12cd34")).toBe("ab12cd34-file")
    const name = uniqueMediaName("x".repeat(500) + ".png", "ab12cd34")
    expect(name.length).toBeLessThanOrEqual(100)
    const key = proposalMediaKey(NET, ID, name)
    expect(ownMediaKey(key, NET, ID)).toBe(key)
  })
})

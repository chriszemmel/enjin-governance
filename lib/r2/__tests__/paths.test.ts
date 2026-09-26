import { describe, expect, it } from "vitest"
import {
  isPublicReadableKey,
  proposalJsonKey,
  publicUrlFor,
} from "@/lib/r2/paths"

describe("publicUrlFor", () => {
  it("joins base and key with a single slash", () => {
    expect(publicUrlFor("https://gov.enjin.cloud/r", "proposals/a/b.json")).toBe(
      "https://gov.enjin.cloud/r/proposals/a/b.json",
    )
  })

  it("trims a trailing slash on the base", () => {
    expect(publicUrlFor("https://gov.enjin.cloud/r/", "user-avatars/x.png")).toBe(
      "https://gov.enjin.cloud/r/user-avatars/x.png",
    )
  })
})

describe("isPublicReadableKey", () => {
  it("allows proposal JSON keys", () => {
    const key = proposalJsonKey("enjin-relay", "11111111-1111-1111-1111-111111111111")
    expect(isPublicReadableKey(key)).toBe(true)
  })

  it("allows proposal media and avatar keys", () => {
    expect(isPublicReadableKey("proposals/enjin-relay/u/media/pic.png")).toBe(true)
    expect(isPublicReadableKey("user-avatars/abc.png")).toBe(true)
  })

  it("rejects keys outside the public prefixes", () => {
    expect(isPublicReadableKey("secrets/key.txt")).toBe(false)
    expect(isPublicReadableKey("")).toBe(false)
  })

  it("never serves backups", () => {
    expect(isPublicReadableKey(`backups/2026-09-26T09:00:00Z-${"0".repeat(32)}.zip`)).toBe(false)
    expect(isPublicReadableKey("proposals/../backups/x.zip")).toBe(false)
  })

  it("rejects path traversal and absolute paths", () => {
    expect(isPublicReadableKey("proposals/../secrets/x")).toBe(false)
    expect(isPublicReadableKey("/proposals/enjin-relay/u/proposal.json")).toBe(false)
    expect(isPublicReadableKey("proposals\\..\\x")).toBe(false)
  })
})

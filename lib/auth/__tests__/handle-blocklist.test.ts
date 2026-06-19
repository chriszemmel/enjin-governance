import { describe, expect, it } from "vitest"
import {
  validateDisplayName,
  validateHandle,
} from "@/lib/auth/handle-blocklist"

describe("validateHandle", () => {
  it("accepts normal handles", () => {
    expect(validateHandle("chris")).toBeNull()
    expect(validateHandle("alice_92")).toBeNull()
    expect(validateHandle("a1b2_c3")).toBeNull()
  })

  it("rejects handles shorter than 3 chars", () => {
    expect(validateHandle("ab")).toBe("too_short")
    expect(validateHandle("")).toBe("too_short")
  })

  it("rejects bad characters and case", () => {
    expect(validateHandle("Alice")).toBe("format")
    expect(validateHandle("with space")).toBe("format")
    expect(validateHandle("hyphen-name")).toBe("format")
    expect(validateHandle("dot.name")).toBe("format")
  })

  it("blocks reserved role / project handles", () => {
    expect(validateHandle("admin")).toBe("reserved")
    expect(validateHandle("support")).toBe("reserved")
    expect(validateHandle("enjin")).toBe("reserved")
    expect(validateHandle("governance")).toBe("reserved")
    expect(validateHandle("treasury")).toBe("reserved")
    expect(validateHandle("moderator")).toBe("reserved")
    expect(validateHandle("opengov")).toBe("reserved")
  })

  it("treats uppercase as a format error", () => {
    // The client lowercases on type. Uppercase reaching the server is
    // a format violation, not a soft-canonicalised "reserved" hit.
    expect(validateHandle("ADMIN")).toBe("format")
    expect(validateHandle("admin")).toBe("reserved")
  })

  it("rejects profanity", () => {
    expect(validateHandle("nazi_rules")).toBe("profane")
    expect(validateHandle("fckthis")).toBeNull() // not in list, OK
  })
})

describe("validateDisplayName", () => {
  it("accepts normal display names", () => {
    expect(validateDisplayName("Alice Q.")).toBeNull()
    expect(validateDisplayName("Chris Z")).toBeNull()
    expect(validateDisplayName("")).toBeNull()
  })

  it("blocks impersonation phrases", () => {
    expect(validateDisplayName("Enjin Support")).toBe("impersonation")
    expect(validateDisplayName("Official Enjin")).toBe("impersonation")
    expect(validateDisplayName("Governance Team")).toBe("impersonation")
    expect(validateDisplayName("ENJIN SUPPORT")).toBe("impersonation")
    expect(validateDisplayName("Verified Account")).toBe("impersonation")
  })

  it("blocks profanity in display names", () => {
    expect(validateDisplayName("Nazi Lord")).toBe("profane")
  })

  it("allows partial matches that aren't on the list", () => {
    expect(validateDisplayName("Enjin Fan")).toBeNull()
    expect(validateDisplayName("Supporter")).toBeNull()
  })
})

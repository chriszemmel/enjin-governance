import { describe, expect, it } from "vitest"
import {
  normalizeDisplayName,
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

describe("validateDisplayName with look-alike text", () => {
  it("sees through Unicode spaces", () => {
    for (const space of [
      "\u00A0", // no-break space
      "\u2002", // en space
      "\u2003", // em space
      "\u2009", // thin space
      "\u202F", // narrow no-break space
      "\u205F", // medium mathematical space
      "\u3000", // ideographic space
      "\u1680", // ogham space mark
      "\u2028", // line separator
      "\t",
      "   ",
    ]) {
      expect(validateDisplayName(`Enjin${space}Support`), JSON.stringify(space)).toBe(
        "impersonation",
      )
    }
  })

  it("sees through zero-width and direction-control characters", () => {
    expect(validateDisplayName("Enjin \u200B Support")).toBe("impersonation")
    expect(validateDisplayName("En\u200Bjin Sup\u200Cport")).toBe("impersonation")
    expect(validateDisplayName("Enjin\u200D Support")).toBe("impersonation")
    expect(validateDisplayName("\uFEFFOfficial\u2060 Enjin")).toBe("impersonation")
    expect(validateDisplayName("\u202EEnjin Support\u202C")).toBe("impersonation")
    expect(validateDisplayName("\u2066Verified\u2069 Account")).toBe("impersonation")
    expect(validateDisplayName("Enjin \u00ADSupport")).toBe("impersonation")
    expect(validateDisplayName("n\u200Bazi")).toBe("profane")
  })

  it("folds full-width, styled and accented letters and punctuation", () => {
    expect(validateDisplayName("Ｅｎｊｉｎ Ｓｕｐｐｏｒｔ")).toBe("impersonation")
    expect(validateDisplayName("𝐄𝐧𝐣𝐢𝐧 𝐒𝐮𝐩𝐩𝐨𝐫𝐭")).toBe("impersonation")
    expect(validateDisplayName("Ënjîn Süppört")).toBe("impersonation")
    expect(validateDisplayName("Enjin-Support")).toBe("impersonation")
    expect(validateDisplayName("Enjin_Support")).toBe("impersonation")
    expect(validateDisplayName("Official • Enjin")).toBe("impersonation")
  })

  it("still leaves ordinary names alone", () => {
    expect(validateDisplayName("Zoë Ångström")).toBeNull()
    expect(validateDisplayName("Ben Jin Team")).toBeNull()
    expect(validateDisplayName("EnjinSupporter")).toBeNull()
    expect(validateDisplayName("محمد\u200Cرضا")).toBeNull()
    expect(validateDisplayName("👩\u200D💻 Dev")).toBeNull()
  })

  it("counts the length of the cleaned name", () => {
    expect(validateDisplayName(`${"a".repeat(80)}\u200B\u200B`)).toBeNull()
    expect(validateDisplayName("a".repeat(81))).toBe("too_long")
  })
})

describe("normalizeDisplayName", () => {
  it("drops invisible and direction controls and plain-spaces the rest", () => {
    expect(normalizeDisplayName("  Alice\u200B\u00A0\u3000 Smith\u202E ")).toBe("Alice Smith")
    expect(normalizeDisplayName("\u202Etroppus nijnE")).toBe("troppus nijnE")
    expect(normalizeDisplayName("Bob\tthe\nBuilder")).toBe("Bob the Builder")
    expect(normalizeDisplayName("\u200B\uFEFF ")).toBe("")
  })

  it("keeps the letters as typed, and the joiners names need", () => {
    expect(normalizeDisplayName("Ｋｅｎ Zoë")).toBe("Ｋｅｎ Zoë")
    expect(normalizeDisplayName("محمد\u200Cرضا")).toBe("محمد\u200Cرضا")
    expect(normalizeDisplayName("👩\u200D💻 Dev")).toBe("👩\u200D💻 Dev")
  })
})

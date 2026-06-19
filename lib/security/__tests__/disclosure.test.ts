import { describe, expect, it } from "vitest"
import {
  disclosureSchema,
  formatDisclosureMessage,
  HONEYPOT_FIELD,
  isHoneypotTripped,
  SEVERITIES,
} from "@/lib/security/disclosure"

const valid = {
  severity: "high" as const,
  category: "Web app / frontend",
  summary: "Stored XSS in comments",
  details: "The comment body is rendered without sanitising - script runs.",
  contact: "researcher@example.com",
}

describe("disclosureSchema", () => {
  it("accepts a well-formed report", () => {
    expect(disclosureSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects an unknown severity", () => {
    expect(
      disclosureSchema.safeParse({ ...valid, severity: "spicy" }).success,
    ).toBe(false)
  })

  it("rejects a too-short summary / details", () => {
    expect(disclosureSchema.safeParse({ ...valid, summary: "short" }).success).toBe(false)
    expect(disclosureSchema.safeParse({ ...valid, details: "too short" }).success).toBe(false)
  })

  it("trims and allows omitting the optional contact/category/network", () => {
    const parsed = disclosureSchema.parse({
      severity: "low",
      summary: "  a valid summary here  ",
      details: "a sufficiently long set of reproduction details here",
    })
    expect(parsed.summary).toBe("a valid summary here")
    expect(parsed.contact).toBeUndefined()
  })

  it("covers every severity value", () => {
    for (const s of SEVERITIES) {
      expect(disclosureSchema.safeParse({ ...valid, severity: s }).success).toBe(true)
    }
  })
})

describe("isHoneypotTripped", () => {
  it("is false for a normal submission (honeypot empty or absent)", () => {
    expect(isHoneypotTripped(valid)).toBe(false)
    expect(isHoneypotTripped({ ...valid, [HONEYPOT_FIELD]: "" })).toBe(false)
    expect(isHoneypotTripped({ ...valid, [HONEYPOT_FIELD]: "   " })).toBe(false)
  })

  it("is true when the hidden field carries a value (a bot filled it)", () => {
    expect(isHoneypotTripped({ ...valid, [HONEYPOT_FIELD]: "http://spam.example" })).toBe(true)
  })

  it("tolerates non-object bodies", () => {
    expect(isHoneypotTripped(null)).toBe(false)
    expect(isHoneypotTripped("nope")).toBe(false)
    expect(isHoneypotTripped(42)).toBe(false)
  })
})

describe("formatDisclosureMessage", () => {
  it("includes severity, summary, contact and the ref id", () => {
    const msg = formatDisclosureMessage(disclosureSchema.parse(valid), "abc-123")
    expect(msg).toContain("[HIGH]")
    expect(msg).toContain("Stored XSS in comments")
    expect(msg).toContain("Contact: researcher@example.com")
    expect(msg).toContain("Ref: abc-123")
  })

  it("notes when no contact was provided", () => {
    const msg = formatDisclosureMessage(
      disclosureSchema.parse({ severity: "low", summary: "a summary line", details: "enough detail to pass validation here" }),
      "id-1",
    )
    expect(msg).toContain("No contact provided")
  })

  it("truncates very long details", () => {
    const long = "x".repeat(3000)
    const msg = formatDisclosureMessage(
      disclosureSchema.parse({ severity: "low", summary: "a summary line", details: long }),
      "id-2",
    )
    expect(msg).toContain("…")
    expect(msg.length).toBeLessThan(2000)
  })
})

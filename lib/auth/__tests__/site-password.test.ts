import { describe, expect, it } from "vitest"
import { passwordMatches, timingSafeEqual } from "@/lib/auth/site-password"

describe("passwordMatches", () => {
  const PASSWORD = "correct horse battery staple"

  it("accepts only the exact password", async () => {
    expect(await passwordMatches(PASSWORD, PASSWORD)).toBe(true)
    for (const guess of [
      "",
      "c",
      PASSWORD.slice(0, -1),
      `${PASSWORD} `,
      PASSWORD.toUpperCase(),
      PASSWORD.repeat(40),
      "correct horse battery staplé",
    ]) {
      expect(await passwordMatches(guess, PASSWORD), JSON.stringify(guess)).toBe(false)
    }
  })

  it("handles non-ASCII passwords", async () => {
    expect(await passwordMatches("pässwört 🔑", "pässwört 🔑")).toBe(true)
    expect(await passwordMatches("passwort 🔑", "pässwört 🔑")).toBe(false)
  })
})

describe("timingSafeEqual", () => {
  it("still compares equal-length strings exactly (used for the cookie digest)", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true)
    expect(timingSafeEqual("abc", "abd")).toBe(false)
    expect(timingSafeEqual("abc", "abcd")).toBe(false)
  })
})

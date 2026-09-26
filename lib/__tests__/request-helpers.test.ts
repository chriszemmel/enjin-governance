import { describe, expect, it } from "vitest"
import { readApiError } from "@/lib/utils/api-error"
import { safeRedirectPath } from "@/lib/utils/safe-redirect"

describe("readApiError", () => {
  it("uses the error field of our JSON responses", async () => {
    const res = new Response(JSON.stringify({ ok: false, error: "Sign in to cancel a proposal." }), { status: 401 })
    expect(await readApiError(res)).toBe("Sign in to cancel a proposal.")
  })
  it("falls back to the text body, then the status", async () => {
    expect(await readApiError(new Response("Bad gateway", { status: 502 }))).toBe("Bad gateway")
    expect(await readApiError(new Response(null, { status: 500 }))).toBe("HTTP 500")
  })
})

describe("safeRedirectPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeRedirectPath("/create")).toBe("/create")
    expect(safeRedirectPath("/proposals/12?network=canary-relay")).toBe("/proposals/12?network=canary-relay")
  })
  it("rejects anything that could leave the site", () => {
    for (const bad of [null, "", "https://evil.com", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "javascript:alert(1)", "create"]) {
      expect(safeRedirectPath(bad)).toBeNull()
    }
  })
})

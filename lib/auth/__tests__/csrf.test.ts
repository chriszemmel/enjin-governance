import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { enforceSameOrigin } from "@/lib/auth/csrf"

function req(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://gov.enjin.io${path}`, {
    method,
    headers: { host: "gov.enjin.io", ...headers },
  })
}

describe("enforceSameOrigin", () => {
  it("allows a same-origin POST", () => {
    expect(
      enforceSameOrigin(req("POST", "/api/proposals/draft", { origin: "https://gov.enjin.io" })),
    ).toBeNull()
  })

  it("blocks a cross-origin POST", () => {
    const res = enforceSameOrigin(
      req("POST", "/api/proposals/draft", { origin: "https://evil.example" }),
    )
    expect(res?.status).toBe(403)
  })

  it("ignores safe methods even cross-origin", () => {
    expect(
      enforceSameOrigin(req("GET", "/api/proposals/draft", { origin: "https://evil.example" })),
    ).toBeNull()
  })

  it("ignores non-API paths", () => {
    expect(
      enforceSameOrigin(req("POST", "/account", { origin: "https://evil.example" })),
    ).toBeNull()
  })

  it("allows when neither Origin nor Referer is present (non-browser client)", () => {
    expect(enforceSameOrigin(req("POST", "/api/proposals/draft"))).toBeNull()
  })

  it("falls back to Referer when Origin is absent", () => {
    expect(
      enforceSameOrigin(req("DELETE", "/api/comments/1", { referer: "https://gov.enjin.io/proposals/5" })),
    ).toBeNull()
    expect(
      enforceSameOrigin(
        req("DELETE", "/api/comments/1", { referer: "https://evil.example/x" }),
      )?.status,
    ).toBe(403)
  })

  it("blocks a malformed Origin", () => {
    expect(
      enforceSameOrigin(req("POST", "/api/proposals/draft", { origin: "not-a-url" }))?.status,
    ).toBe(403)
  })
})

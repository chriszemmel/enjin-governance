import { describe, expect, it } from "vitest"
import { friendlyError } from "@/lib/utils/format-error"

describe("friendlyError", () => {
  it("classifies polkadot.js WS disconnect as a network failure", () => {
    const e = new Error(
      'WebSocket is not connected Failed WS Request: {"method":"state_queryStorageAt","params":[["0xdeadbeef"]]}',
    )
    const f = friendlyError(e)
    expect(f.headline).toBe("Couldn't reach the chain")
    expect(f.detail).toMatch(/internet/i)
    expect(f.technical).toContain("WebSocket")
  })

  it("classifies fetch failure as network", () => {
    const f = friendlyError(new TypeError("Failed to fetch"))
    expect(f.headline).toBe("Couldn't reach the chain")
  })

  it("classifies timeout messages distinctly", () => {
    const f = friendlyError(new Error("Request timed out after 10s"))
    expect(f.headline).toBe("Connection timed out")
  })

  it("flags 'API not ready' as a transient connecting state", () => {
    const f = friendlyError(new Error("API not ready"))
    expect(f.headline).toBe("Connecting…")
  })

  it("falls back to a generic message for unknown errors", () => {
    const f = friendlyError(new Error("Something exploded in the runtime"))
    expect(f.headline).toBe("Something went wrong")
    expect(f.technical).toContain("exploded")
  })

  it("handles non-Error inputs gracefully", () => {
    expect(friendlyError("plain string").technical).toBe("plain string")
    expect(friendlyError(null).technical).toBeNull()
    expect(friendlyError(undefined).technical).toBeNull()
  })
})

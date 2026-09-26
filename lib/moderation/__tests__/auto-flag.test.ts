import { describe, expect, it, vi, beforeEach } from "vitest"

vi.hoisted(() => {
  process.env.CONTENT_SCAN = "ON"
  process.env.ANTHROPIC_API_KEY = "test-key"
})
const scan = vi.hoisted(() => ({ next: null as unknown }))
vi.mock("@/lib/moderation/scan", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  scanImage: async () => scan.next,
}))
vi.mock("@/lib/db/moderation", () => ({
  setState: async () => undefined,
  insertReport: async () => true,
}))

import { checkUpload } from "@/lib/moderation/auto-flag"

const jpeg = async () => Buffer.from("jpeg")
const verdict = (decision: "allow" | "review" | "block") => ({
  kind: "verdict",
  verdict: {
    decision,
    severity: "high",
    labels: ["recovery_phrase"],
    explanation: "A 12-word recovery phrase is readable.",
  },
})

describe("checkUpload", () => {
  beforeEach(() => {
    scan.next = null
  })

  it("rejects clear violations before anything is stored", async () => {
    scan.next = verdict("block")
    const d = await checkUpload(jpeg, "wallet.png")
    expect(d.action).toBe("reject")
    expect(d.action === "reject" && d.message).toContain("recovery phrase")
  })

  it("stores borderline images blurred, and treats a refusal the same way", async () => {
    scan.next = verdict("review")
    expect((await checkUpload(jpeg, "a.png")).action).toBe("store_blurred")
    scan.next = { kind: "refused" }
    expect((await checkUpload(jpeg, "a.png")).action).toBe("store_blurred")
  })

  it("never blocks an upload because the check itself failed", async () => {
    scan.next = { kind: "unavailable", reason: "timeout" }
    expect((await checkUpload(jpeg, "a.png")).action).toBe("store")
    scan.next = verdict("allow")
    expect((await checkUpload(jpeg, "a.png")).action).toBe("store")
    expect(
      (await checkUpload(async () => Promise.reject(new Error("sharp")), "a.png")).action,
    ).toBe("store")
  })
})

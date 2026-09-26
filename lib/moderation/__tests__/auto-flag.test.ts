import { describe, expect, it, vi, beforeEach } from "vitest"

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key"
})
const scan = vi.hoisted(() => ({
  next: null as unknown,
  models: [] as string[],
  plan: null as unknown,
  underLimit: true,
  usage: [] as unknown[][],
}))
vi.mock("@/lib/moderation/scan", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  scanImage: async (_: Buffer, opts: { model: string }) => {
    scan.models.push(opts.model)
    return scan.next
  },
}))
vi.mock("@/lib/moderation/settings-store", () => ({
  scanPlan: async () => scan.plan,
  reserveScan: async () => scan.underLimit,
  noteScanUsage: async (...args: unknown[]) => {
    scan.usage.push(args)
  },
}))
vi.mock("@/lib/db/moderation", () => ({
  setState: async () => undefined,
  insertReport: async () => true,
}))

import { checkUpload, pdfPageEstimate } from "@/lib/moderation/auto-flag"
import { DEFAULT_SCAN_SETTINGS } from "@/lib/moderation/scan-settings"

const image = { kind: "image" as const, jpeg: async () => Buffer.from("jpeg") }
const verdict = (decision: "allow" | "review" | "block") => ({
  kind: "verdict",
  verdict: {
    decision,
    severity: "high",
    labels: ["recovery_phrase"],
    explanation: "A 12-word recovery phrase is readable.",
  },
  usage: { inputTokens: 1900, outputTokens: 80 },
})
const planWith = (over: Partial<typeof DEFAULT_SCAN_SETTINGS> = {}) => {
  const settings = { ...DEFAULT_SCAN_SETTINGS, enabled: true, ...over }
  return { model: settings.model, settings }
}

describe("checkUpload", () => {
  beforeEach(() => {
    scan.next = null
    scan.models = []
    scan.usage = []
    scan.plan = planWith()
    scan.underLimit = true
  })

  it("rejects clear violations before anything is stored", async () => {
    scan.next = verdict("block")
    const d = await checkUpload(image, "wallet.png")
    expect(d.action).toBe("reject")
    expect(d.action === "reject" && d.message).toContain("recovery phrase")
  })

  it("holds clear violations for a moderator when admins chose that", async () => {
    scan.plan = planWith({ onClearViolation: "hold" })
    scan.next = verdict("block")
    expect((await checkUpload(image, "wallet.png")).action).toBe("store_blurred")
  })

  it("stores borderline images blurred, and treats a refusal the same way", async () => {
    scan.next = verdict("review")
    expect((await checkUpload(image, "a.png")).action).toBe("store_blurred")
    scan.next = { kind: "refused" }
    expect((await checkUpload(image, "a.png")).action).toBe("store_blurred")
  })

  it("uses the chosen model and counts the check", async () => {
    scan.plan = planWith({ model: "claude-sonnet-5" })
    scan.next = verdict("allow")
    await checkUpload(image, "a.png")
    expect(scan.models).toEqual(["claude-sonnet-5"])
    expect(scan.usage).toEqual([["images", "claude-sonnet-5", scan.next]])
  })

  it("stores without a check when checks or this kind are switched off", async () => {
    scan.plan = null
    scan.next = verdict("block")
    expect((await checkUpload(image, "a.png")).action).toBe("store")
    expect(scan.models).toEqual([])
  })

  it("holds what it can't check for reasons the uploader controls", async () => {
    scan.next = verdict("allow")
    const animated = { ...image, animated: true }
    expect((await checkUpload(animated, "a.gif")).action).toBe("store_blurred")
    const longPdf = Buffer.from(
      "%PDF-1.4\n" + "<< /Type /Page >>\n".repeat(31) + "<< /Type /Pages >>",
    )
    expect(pdfPageEstimate(longPdf)).toBe(31)
    expect((await checkUpload({ kind: "pdf", bytes: longPdf }, "long.pdf")).action).toBe(
      "store_blurred",
    )
    scan.next = { kind: "unavailable", reason: "API 400" }
    expect((await checkUpload(image, "huge.png")).action).toBe("store_blurred")
    expect(scan.models).toHaveLength(1) // the animation and the long PDF were never sent
  })

  it("holds uploads once the daily limit is reached", async () => {
    scan.underLimit = false
    scan.next = verdict("allow")
    expect((await checkUpload(image, "a.png")).action).toBe("store_blurred")
    expect(scan.models).toEqual([])
  })

  it("never blocks an upload because the check itself failed", async () => {
    scan.next = { kind: "unavailable", reason: "timeout" }
    expect((await checkUpload(image, "a.png")).action).toBe("store")
    scan.next = { kind: "unavailable", reason: "API 529" }
    expect((await checkUpload(image, "a.png")).action).toBe("store")
    scan.next = { kind: "unavailable", reason: "API 429" }
    expect((await checkUpload(image, "a.png")).action).toBe("store")
    scan.next = verdict("allow")
    expect((await checkUpload(image, "a.png")).action).toBe("store")
    expect(
      (
        await checkUpload(
          { kind: "image", jpeg: async () => Promise.reject(new Error("sharp")) },
          "a.png",
        )
      ).action,
    ).toBe("store")
  })
})

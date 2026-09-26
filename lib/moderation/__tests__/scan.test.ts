/**
 * The content scanner with a fake Anthropic client: request shape, how
 * answers, refusals and failures are mapped, and the upload decisions
 * built on top. No network, no cost.
 */
import { describe, expect, it, vi } from "vitest"
import Anthropic from "@anthropic-ai/sdk"

vi.hoisted(() => {
  process.env.CONTENT_SCAN = "ON"
  process.env.ANTHROPIC_API_KEY = "test-key"
})

import { categoryFor, scanImage, scanText } from "@/lib/moderation/scan"

type Call = { body: Record<string, unknown>; options: Record<string, unknown> }

function fakeClient(reply: () => unknown) {
  const calls: Call[] = []
  const client = {
    beta: {
      messages: {
        create: async (body: Record<string, unknown>, options: Record<string, unknown>) => {
          calls.push({ body, options })
          return reply()
        },
      },
    },
  } as unknown as Pick<Anthropic, "beta">
  return { client, calls }
}

const answer = (json: unknown, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text: JSON.stringify(json) }],
})

describe("scanImage", () => {
  it("sends one low-effort, structured request with refusal fallbacks", async () => {
    const { client, calls } = fakeClient(() =>
      answer({ decision: "allow", severity: "low", labels: [], explanation: "A roadmap chart." }),
    )
    const out = await scanImage(Buffer.from("jpeg-bytes"), { client, fileName: "roadmap.png" })
    expect(out).toEqual({
      kind: "verdict",
      verdict: { decision: "allow", severity: "low", labels: [], explanation: "A roadmap chart." },
    })
    const body = calls[0]!.body as {
      model: string
      betas: string[]
      fallbacks: string
      output_config: { effort: string; format: { type: string } }
      messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[]
    }
    expect(body.model).toBe("claude-opus-5")
    expect(body.betas).toEqual(["server-side-fallback-2026-07-01"])
    expect(body.fallbacks).toBe("default")
    expect(body.output_config.effort).toBe("low")
    expect(body.output_config.format.type).toBe("json_schema")
    const image = body.messages[0]!.content[0]!
    expect(image.type).toBe("image")
    expect(image.source).toMatchObject({
      media_type: "image/jpeg",
      data: Buffer.from("jpeg-bytes").toString("base64"),
    })
  })

  it("treats a refusal as refused, and every failure as unavailable", async () => {
    expect(
      await scanImage(Buffer.from("x"), {
        client: fakeClient(() => ({ stop_reason: "refusal", content: [] })).client,
      }),
    ).toEqual({
      kind: "refused",
    })
    const garbled = fakeClient(() => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "not json" }],
    }))
    expect((await scanImage(Buffer.from("x"), { client: garbled.client })).kind).toBe("unavailable")
    const wrongShape = fakeClient(() => answer({ decision: "maybe" }))
    expect((await scanImage(Buffer.from("x"), { client: wrongShape.client })).kind).toBe(
      "unavailable",
    )
    const truncated = fakeClient(() => answer({}, "max_tokens"))
    expect((await scanImage(Buffer.from("x"), { client: truncated.client })).kind).toBe(
      "unavailable",
    )
    const down = fakeClient(() => {
      throw new Anthropic.InternalServerError(500, undefined, "boom", new Headers())
    })
    expect(await scanImage(Buffer.from("x"), { client: down.client })).toEqual({
      kind: "unavailable",
      reason: "API 500",
    })
  })
})

describe("scanText", () => {
  it("wraps the text as data and returns the verdict", async () => {
    const { client, calls } = fakeClient(() =>
      answer({
        decision: "review",
        severity: "medium",
        labels: ["scam_phishing"],
        explanation: "Asks readers to verify their seed on an outside site.",
      }),
    )
    const out = await scanText("Claim your airdrop: enter your seed at example.bad", "comment", {
      client,
    })
    expect(out.kind === "verdict" && out.verdict.decision).toBe("review")
    const content = (calls[0]!.body as { messages: { content: { text: string }[] }[] }).messages[0]!
      .content[0]!.text
    expect(content).toContain("<content>\nClaim your airdrop")
  })
})

describe("categoryFor", () => {
  it("files the most serious label first", () => {
    expect(categoryFor({ labels: ["spam", "recovery_phrase"] })).toBe("secrets")
    expect(categoryFor({ labels: ["id_document"] })).toBe("personal_data")
    expect(categoryFor({ labels: ["scam_phishing", "spam"] })).toBe("scam")
    expect(categoryFor({ labels: [] })).toBe("other")
  })
})

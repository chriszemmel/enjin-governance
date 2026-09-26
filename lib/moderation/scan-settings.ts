/**
 * Settings for the automatic content checks (patch v1.7), shared by the
 * API, the scanner and the admin UI. Pure: no I/O here.
 */

import { z } from "zod"

/**
 * Models an admin can pick, with list prices in USD per million tokens
 * (Anthropic pricing, September 2026). Haiku is the default: the job is a
 * short classification, and every non-obvious case goes to a person anyway.
 */
export const SCAN_MODELS = {
  "claude-haiku-4-5": {
    label: "Claude Haiku 4.5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    note: "Fastest and cheapest. Reads screenshots well; fine for clear-cut checks.",
  },
  "claude-sonnet-5": {
    label: "Claude Sonnet 5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    note: "Middle ground: better on subtle scams, about twice the cost of Haiku.",
  },
  "claude-opus-5": {
    label: "Claude Opus 5",
    inputPerMTok: 5,
    outputPerMTok: 25,
    note: "Most careful judgement, about five times the cost of Haiku.",
  },
} as const

export type ScanModel = keyof typeof SCAN_MODELS
export const SCAN_MODEL_IDS = Object.keys(SCAN_MODELS) as ScanModel[]

export const SCAN_KINDS = ["images", "pdfs", "proposals", "comments"] as const
export type ScanKind = (typeof SCAN_KINDS)[number]

export const scanSettingsSchema = z
  .object({
    enabled: z.boolean(),
    model: z.enum(SCAN_MODEL_IDS as [ScanModel, ...ScanModel[]]),
    images: z.boolean(),
    pdfs: z.boolean(),
    proposals: z.boolean(),
    comments: z.boolean(),
    /** A clear violation (e.g. a readable recovery phrase) at upload. */
    onClearViolation: z.enum(["reject", "hold"]),
    /** Checks per day across all kinds; beyond it, content isn't checked. */
    dailyLimit: z.number().int().min(0).max(100_000),
  })
  .strict()

export type ScanSettings = z.infer<typeof scanSettingsSchema>

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  enabled: false,
  model: "claude-haiku-4-5",
  images: true,
  pdfs: true,
  proposals: true,
  comments: true,
  onClearViolation: "reject",
  dailyLimit: 300,
}

/** Stored settings merged over the defaults; anything invalid falls back. */
export function parseStoredSettings(raw: unknown): ScanSettings {
  const merged = { ...DEFAULT_SCAN_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) }
  const parsed = scanSettingsSchema.safeParse(merged)
  return parsed.success ? parsed.data : DEFAULT_SCAN_SETTINGS
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const m = SCAN_MODELS[model as ScanModel]
  if (!m) return 0
  return (inputTokens * m.inputPerMTok + outputTokens * m.outputPerMTok) / 1_000_000
}

/**
 * Typical tokens per check, for the estimates in the settings screen:
 * the policy prompt (~450) plus the item, and a short JSON answer. Images
 * are sent at up to 1568 px (~1,600 tokens on Haiku, up to ~2,500 on the
 * high-resolution models).
 */
export const TYPICAL_TOKENS: Record<ScanKind, { input: number; output: number }> = {
  images: { input: 2_300, output: 150 },
  pdfs: { input: 8_000, output: 150 },
  proposals: { input: 4_500, output: 150 },
  comments: { input: 600, output: 120 },
}

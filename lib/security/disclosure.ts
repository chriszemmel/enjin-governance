/**
 * Shared validation + options for the public security-disclosure form.
 * Pure (no `server-only`) so the API route, the form page, and unit tests can
 * all import it.
 */

import { z } from "zod"

export const SEVERITIES = ["low", "medium", "high", "critical"] as const
export type Severity = (typeof SEVERITIES)[number]

// The surfaces this governance dApp actually exposes - no smart contracts
// (Enjin is Substrate/OpenGov, not EVM). These map to where a real bug here
// would live: how it builds/signs governance extrinsics, the wallet handshake,
// the web UI, the auth/API/storage backend, and the proposal/treasury flow.
export const DISCLOSURE_CATEGORIES = [
  "Voting / extrinsic construction",
  "Wallet connection / signing",
  "Web app / frontend (XSS, UI)",
  "Auth / API / backend",
  "Proposal / treasury flow",
  "Other",
] as const

export const disclosureSchema = z.object({
  severity: z.enum(SEVERITIES),
  category: z.string().max(60).nullable().optional(),
  /** One-line headline. */
  summary: z.string().trim().min(8).max(200),
  /** Full write-up: impact, steps to reproduce, affected component. */
  details: z.string().trim().min(20).max(10_000),
  /** Optional contact (email / handle) for coordinated follow-up. */
  contact: z.string().trim().max(200).nullable().optional(),
  /** Optional chain id the report relates to. */
  network: z.string().max(40).nullable().optional(),
})

export type DisclosureInput = z.infer<typeof disclosureSchema>

/**
 * Name of a decoy form field that no human ever fills: it's visually hidden,
 * pulled out of the tab order, and marked aria-hidden, so only an automated
 * bot that blindly populates every input will put a value in it. The server
 * treats a filled honeypot as a bot and silently drops the submission.
 */
export const HONEYPOT_FIELD = "website"

/**
 * Pure: true when the honeypot field carries a value - the tell-tale sign of
 * a bot. Tolerant of any raw JSON shape (runs before schema validation).
 */
export function isHoneypotTripped(body: unknown): boolean {
  if (body == null || typeof body !== "object") return false
  const v = (body as Record<string, unknown>)[HONEYPOT_FIELD]
  return typeof v === "string" && v.trim().length > 0
}

/** Pure: format a disclosure as a plain-text notification (e.g. Telegram). */
export function formatDisclosureMessage(
  input: DisclosureInput,
  id: string,
): string {
  const detail =
    input.details.length > 1500
      ? `${input.details.slice(0, 1500)}…`
      : input.details
  return [
    `🔐 New security disclosure [${input.severity.toUpperCase()}]`,
    input.category ? `Area: ${input.category}` : null,
    input.network ? `Network: ${input.network}` : null,
    "",
    input.summary,
    "",
    detail,
    "",
    input.contact ? `Contact: ${input.contact}` : "No contact provided",
    `Ref: ${id}`,
  ]
    .filter((line) => line !== null)
    .join("\n")
}

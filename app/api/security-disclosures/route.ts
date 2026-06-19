import { randomUUID } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { isDbConfigured } from "@/lib/db/client"
import { createSecurityDisclosure } from "@/lib/db/security-disclosures"
import { disclosureSchema, isHoneypotTripped } from "@/lib/security/disclosure"
import { notifySecurityDisclosure } from "@/lib/security/notify"
import { enforceRateLimit, ipFromHeaders, RATE_LIMITS } from "@/lib/rate-limit"

export const runtime = "nodejs"

/**
 * Public, unauthenticated endpoint for security / vulnerability reports.
 * Persists to the DB (durable triage queue) and best-effort notifies a
 * Telegram chat when configured. IP-rate-limited against floods.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Reporting is temporarily unavailable." },
      { status: 503 },
    )
  }

  const ip = ipFromHeaders(request.headers)
  const rl = await enforceRateLimit({ ...RATE_LIMITS.securityDisclosure, identity: ip })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many reports - please wait a moment before trying again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid submission" },
      { status: 400 },
    )
  }

  // Honeypot: a real user never fills the hidden decoy field. When a bot does,
  // hand back a normal-looking success - nothing is stored, no one is notified
  // - so the bot believes it got through and moves on.
  if (isHoneypotTripped(raw)) {
    return NextResponse.json({ ok: true, id: randomUUID() })
  }

  let parsed
  try {
    parsed = disclosureSchema.parse(raw)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invalid submission" },
      { status: 400 },
    )
  }

  const { id } = await createSecurityDisclosure({
    ...parsed,
    ip,
    userAgent: request.headers.get("user-agent"),
  })

  await notifySecurityDisclosure(parsed, id)

  return NextResponse.json({ ok: true, id })
}

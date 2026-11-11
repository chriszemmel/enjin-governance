import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { buildSiweMessage, freshNonce } from "@/lib/auth/siwe"
import { signInFormatError, signInNetworkOf } from "@/lib/auth/sign-in-network"
import { isDbConfigured } from "@/lib/db/client"
import { gcExpiredNonces, insertNonce } from "@/lib/db/auth-nonces"
import { initializeWasm, isValidSs58 } from "@/lib/chain/ss58"
import { enforceRateLimit, ipFromHeaders, RATE_LIMITS } from "@/lib/rate-limit"

export const runtime = "nodejs"

const bodySchema = z.object({ address: z.string().min(1).max(64) })

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }

  // Unauthenticated endpoint - limit by client IP so a script can't flood
  // the auth_nonces table.
  const rl = await enforceRateLimit({
    ...RATE_LIMITS.authNonce,
    identity: ipFromHeaders(request.headers),
  })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    )
  }

  // Reject anything that isn't a real SS58 address so one key can't mint
  // nonces (and later user rows) under multiple non-canonical encodings.
  await initializeWasm()
  if (!isValidSs58(parsed.address)) {
    return NextResponse.json(
      { ok: false, error: "Invalid address." },
      { status: 400 },
    )
  }
  // Only the formats of the networks this site runs on, so every user row
  // has a network and its handle is unique there. The browser converts a
  // generic or Polkadot address before it gets here.
  if (!signInNetworkOf(parsed.address)) {
    return NextResponse.json(
      { ok: false, error: signInFormatError() },
      { status: 400 },
    )
  }

  const { nonce, expiresAt } = freshNonce()
  const message = buildSiweMessage(parsed.address, nonce)

  // Best-effort cleanup of expired rows on every issue. Cheap (uses
  // the expires_at index) and keeps the table from growing unbounded
  // even without a separate cron.
  void gcExpiredNonces()

  try {
    await insertNonce({
      nonce,
      address: parsed.address,
      message,
      expiresAt,
    })
  } catch (e) {
    console.error("[auth/nonce] insert failed", e instanceof Error ? e.message : String(e))
    return NextResponse.json(
      { ok: false, error: "Could not start sign-in - try again." },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, nonce, message })
}

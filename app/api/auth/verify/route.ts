import { createHash } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { isDbConfigured } from "@/lib/db/client"
import { consumeNonceRow } from "@/lib/db/auth-nonces"
import { upsertUserByAddress } from "@/lib/db/users"
import { insertSession } from "@/lib/db/sessions"
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  mintSessionToken,
  verifySignature,
} from "@/lib/auth/siwe"
import { enforceRateLimit, ipFromHeaders, RATE_LIMITS } from "@/lib/rate-limit"
import { initializeWasm, isValidSs58 } from "@/lib/chain/ss58"

export const runtime = "nodejs"

const bodySchema = z.object({
  address: z.string().min(1).max(64),
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  signature: z.string().regex(/^0x[0-9a-f]+$/i),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }

  // A successful verify mints a session row. Cap per IP as a direct ceiling
  // on session creation (the nonce step already caps the funnel upstream).
  const rl = await enforceRateLimit({
    ...RATE_LIMITS.authVerify,
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

  // One key, one canonical user row: reject non-SS58 input before upsert.
  await initializeWasm()
  if (!isValidSs58(parsed.address)) {
    return NextResponse.json(
      { ok: false, error: "Invalid address." },
      { status: 400 },
    )
  }

  // The nonce row carries the exact message we handed to the wallet
  // (timestamp and all). Verifying against the stored bytes - rather
  // than rebuilding via buildSiweMessage(address, nonce) which would
  // generate a fresh `Issued: <now>` - is what makes the signature
  // check deterministic. The client never supplies the message, so a
  // tampered field still can't sneak through. DELETE … RETURNING is
  // atomic so two concurrent verifies can't both succeed.
  const consumed = await consumeNonceRow({
    nonce: parsed.nonce,
    address: parsed.address,
  })
  if (!consumed) {
    return NextResponse.json(
      { ok: false, error: "Nonce is unknown or expired - request a new one." },
      { status: 401 },
    )
  }

  const ok = await verifySignature(
    consumed.message,
    parsed.signature,
    parsed.address,
  )
  if (!ok) {
    // Surface enough state to a Vercel runtime log to diagnose
    // wallet-shaped mismatches without leaking the actual signature
    // payload. Address + a message digest are enough to reproduce
    // the issued nonce server-side.
    console.warn("[auth/verify] signature did not match", {
      address: parsed.address,
      addressPrefix: parsed.address.slice(0, 3),
      messageLength: consumed.message.length,
      messageSha256: createHash("sha256")
        .update(consumed.message)
        .digest("hex"),
      signatureLength: parsed.signature.length,
    })
    return NextResponse.json(
      { ok: false, error: "Signature did not match the address." },
      { status: 401 },
    )
  }

  const user = await upsertUserByAddress(parsed.address)

  const { token, tokenHash } = mintSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await insertSession({
    tokenHash,
    userId: user.id,
    address: parsed.address,
    expiresAt,
    userAgent: request.headers.get("user-agent"),
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  })

  const response = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      address: user.address,
      handle: user.handle,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
    },
  })
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  })
  return response
}

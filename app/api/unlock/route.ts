import { NextResponse, type NextRequest } from "next/server"
import {
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_MAX_AGE_SECONDS,
  expectedCookieValue,
  sanitizeNext,
  timingSafeEqual,
} from "@/lib/auth/site-password"
import { enforceRateLimit, ipFromHeaders, RATE_LIMITS } from "@/lib/rate-limit"

interface UnlockBody {
  password?: unknown
  next?: unknown
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.SITE_PASSWORD_STATUS !== "ON") {
    return NextResponse.json({ ok: false, error: "Gate is not enabled" }, { status: 404 })
  }

  const expectedPassword = process.env.SITE_PASSWORD
  if (!expectedPassword) {
    return NextResponse.json(
      { ok: false, error: "Site password is not configured" },
      { status: 503 },
    )
  }

  // Cap attempts per IP so the password can't be brute-forced. Enforced
  // before the comparison, so a flood of guesses burns the budget fast.
  const rl = await enforceRateLimit({
    ...RATE_LIMITS.siteUnlock,
    identity: ipFromHeaders(request.headers),
  })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts - please wait and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  let body: UnlockBody
  try {
    body = (await request.json()) as UnlockBody
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  const provided = typeof body.password === "string" ? body.password : ""
  const next = sanitizeNext(typeof body.next === "string" ? body.next : null)

  if (!provided || !timingSafeEqual(provided, expectedPassword)) {
    return NextResponse.json(
      { ok: false, error: "Incorrect password" },
      { status: 401 },
    )
  }

  const cookieValue = await expectedCookieValue(expectedPassword)
  const response = NextResponse.json({ ok: true, next })
  response.cookies.set({
    name: SITE_ACCESS_COOKIE,
    value: cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SITE_ACCESS_MAX_AGE_SECONDS,
  })
  return response
}

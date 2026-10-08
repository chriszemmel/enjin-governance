import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import {
  displayNameErrorMessage,
  handleErrorMessage,
  normalizeDisplayName,
  validateDisplayName,
  validateHandle,
} from "@/lib/auth/handle-blocklist"
import { updateProfile } from "@/lib/db/users"
import { postingSuspendedResponse } from "@/lib/moderation/suspension"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { noStore } from "@/lib/http/no-store"

export const runtime = "nodejs"

// Zod handles shape + length; the blocklist module owns content rules
// (reserved names, impersonation patterns, profanity) so the error
// messages can be specific instead of "Invalid".
const patchSchema = z.object({
  display_name: z.string().max(80).nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  handle: z.string().min(3).max(32).nullable().optional(),
})

async function getHandler(): Promise<NextResponse> {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ ok: false }, { status: 401 })
  return NextResponse.json({
    ok: true,
    user: {
      id: me.id,
      address: me.address,
      handle: me.handle,
      display_name: me.display_name,
      bio: me.bio,
      avatar_url: me.avatar_url,
    },
  })
}

async function patchHandler(request: NextRequest): Promise<NextResponse> {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ ok: false }, { status: 401 })
  const suspended = await postingSuspendedResponse(me)
  if (suspended) return suspended

  const rl = await enforceRateLimit({ ...RATE_LIMITS.profileUpdate, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many profile changes - please wait a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  let parsed
  try {
    parsed = patchSchema.parse(await request.json())
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    )
  }

  // The handle is checked and stored trimmed; the untrimmed text could
  // carry invisible padding past the unique index as a look-alike.
  if (parsed.handle != null) parsed = { ...parsed, handle: parsed.handle.trim() }
  if (parsed.handle != null) {
    const err = validateHandle(parsed.handle)
    if (err) {
      return NextResponse.json(
        { ok: false, error: handleErrorMessage(err) },
        { status: 400 },
      )
    }
    // Handles are unique per network; a row without one (signed in before
    // sign-in was limited to the relay formats) would sit outside the
    // unique index, so it can't claim a handle.
    if (!me.network) {
      return NextResponse.json(
        { ok: false, error: "Sign out and sign in again to set a handle." },
        { status: 409 },
      )
    }
  }
  // Stored as checked: without invisible or direction-control characters
  // that could make it display as something the check never saw.
  if (parsed.display_name != null) {
    const displayName = normalizeDisplayName(parsed.display_name)
    const err = validateDisplayName(displayName)
    if (err) {
      return NextResponse.json(
        { ok: false, error: displayNameErrorMessage(err) },
        { status: 400 },
      )
    }
    parsed = { ...parsed, display_name: displayName }
  }

  try {
    const row = await updateProfile(me.id, parsed)
    return NextResponse.json({
      ok: true,
      user: {
        id: row.id,
        address: row.address,
        handle: row.handle,
        display_name: row.display_name,
        bio: row.bio,
        avatar_url: row.avatar_url,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json(
        { ok: false, error: "That handle is already taken." },
        { status: 409 },
      )
    }
    console.error("[users/me] profile update failed", msg)
    return NextResponse.json(
      { ok: false, error: "Could not save your profile - try again." },
      { status: 500 },
    )
  }
}

// Personal: depends on the session cookie.
export const GET = noStore(getHandler)
export const PATCH = noStore(patchHandler)

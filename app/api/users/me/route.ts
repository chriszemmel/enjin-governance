import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import {
  displayNameErrorMessage,
  handleErrorMessage,
  validateDisplayName,
  validateHandle,
} from "@/lib/auth/handle-blocklist"
import { updateProfile } from "@/lib/db/users"
import { postingSuspendedResponse } from "@/lib/moderation/suspension"

export const runtime = "nodejs"

// Zod handles shape + length; the blocklist module owns content rules
// (reserved names, impersonation patterns, profanity) so the error
// messages can be specific instead of "Invalid".
const patchSchema = z.object({
  display_name: z.string().max(80).nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  handle: z.string().min(3).max(32).nullable().optional(),
})

export async function GET(): Promise<NextResponse> {
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

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ ok: false }, { status: 401 })
  const suspended = await postingSuspendedResponse(me)
  if (suspended) return suspended

  let parsed
  try {
    parsed = patchSchema.parse(await request.json())
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    )
  }

  if (parsed.handle != null) {
    const err = validateHandle(parsed.handle)
    if (err) {
      return NextResponse.json(
        { ok: false, error: handleErrorMessage(err) },
        { status: 400 },
      )
    }
  }
  if (parsed.display_name != null) {
    const err = validateDisplayName(parsed.display_name)
    if (err) {
      return NextResponse.json(
        { ok: false, error: displayNameErrorMessage(err) },
        { status: 400 },
      )
    }
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
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

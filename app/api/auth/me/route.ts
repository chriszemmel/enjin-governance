import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/current-user"
import { noStore } from "@/lib/http/no-store"

export const runtime = "nodejs"

async function getHandler(): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      address: user.address,
      handle: user.handle,
      display_name: user.display_name,
      bio: user.bio,
      avatar_url: user.avatar_url,
    },
  })
}

// Personal: depends on the session cookie.
export const GET = noStore(getHandler)

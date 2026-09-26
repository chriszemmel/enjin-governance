import { NextResponse } from "next/server"

/**
 * Posting pause set by an admin. Returns the 403 to send back, or null
 * when the user may post.
 */
export function postingSuspendedResponse(user: {
  posting_suspended_until?: Date | string | null
}): NextResponse | null {
  const until = user.posting_suspended_until ? new Date(user.posting_suspended_until) : null
  if (!until || until.getTime() <= Date.now()) return null
  return NextResponse.json(
    {
      ok: false,
      error: `Posting is paused for this account until ${until.toISOString().slice(0, 10)}. See the moderation log.`,
    },
    { status: 403 },
  )
}

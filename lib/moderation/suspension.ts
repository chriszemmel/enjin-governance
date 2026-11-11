/**
 * Posting pause set by an admin, looked up by public key so it holds on
 * every network format the wallet signs in with.
 */

import "server-only"
import { NextResponse } from "next/server"
import { publicKeyHex } from "@/lib/auth/roles"
import { isMissingTable } from "@/lib/db/errors"
import { getSuspension } from "@/lib/db/moderation"

/** The 403 to send back, or null when the account may post. */
export async function postingSuspendedResponse(user: {
  address: string
}): Promise<NextResponse | null> {
  let key: string
  try {
    key = publicKeyHex(user.address)
  } catch {
    return null // not a wallet address; nothing can be paused
  }
  let until: Date | null
  try {
    until = await getSuspension(key)
  } catch (err) {
    if (isMissingTable(err)) return null // migration 011 not applied yet
    // Can't tell whether the account is paused: don't let it post.
    return NextResponse.json(
      { ok: false, error: "Posting is unavailable right now - try again in a moment." },
      { status: 503 },
    )
  }
  if (!until) return null
  return NextResponse.json(
    {
      ok: false,
      error: `Posting is paused for this account until ${until.toISOString().slice(0, 10)}. See the moderation log.`,
    },
    { status: 403 },
  )
}

/**
 * Posting pause set by an admin, looked up by public key so it holds on
 * every network format the wallet signs in with.
 */

import "server-only"
import { NextResponse } from "next/server"
import { publicKeyHex } from "@/lib/auth/roles"
import { getSuspension } from "@/lib/db/moderation"

/** The 403 to send back, or null when the account may post. */
export async function postingSuspendedResponse(user: {
  address: string
}): Promise<NextResponse | null> {
  let until: Date | null
  try {
    until = await getSuspension(publicKeyHex(user.address))
  } catch {
    return null // migration 011 not applied yet, or an undecodable address
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

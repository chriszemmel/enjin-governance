/**
 * Resolve the connected user from the session cookie, if any. Used by
 * every route that wants "are you signed in, and as which user". Returns
 * null when no cookie / expired cookie / DB unavailable.
 */

import "server-only"
import { cookies } from "next/headers"
import { SESSION_COOKIE, hashToken } from "@/lib/auth/siwe"
import { isDbConfigured } from "@/lib/db/client"
import { getActiveSession } from "@/lib/db/sessions"
import { getUserByAddress, type UserRow } from "@/lib/db/users"

type CurrentUser = UserRow & { sessionTokenHash: string }

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isDbConfigured()) return null
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const tokenHash = hashToken(token)
  const session = await getActiveSession(tokenHash)
  if (!session) return null
  const user = await getUserByAddress(session.address)
  if (!user) return null
  return { ...user, sessionTokenHash: tokenHash }
}

/**
 * Who may moderate. Admins come from GOVERNANCE_ADMIN_PUBLIC_KEYS (so the
 * first admin needs no database row); everyone else from moderation_roles.
 * Both are keyed by public key, so a wallet keeps its role on every
 * network prefix.
 */

import "server-only"
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/current-user"
import { initializeWasm, publicKeyOf } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import { getGrantedRole } from "@/lib/db/moderation"
import { env } from "@/lib/env"
import { parseAdminKeys, roleAtLeast, type ModerationRole } from "@/lib/moderation/policy"

export function publicKeyHex(address: string): string {
  return `0x${publicKeyOf(address)}`.toLowerCase()
}

export async function roleFor(address: string): Promise<ModerationRole | null> {
  await initializeWasm()
  let key: string
  try {
    key = publicKeyHex(address)
  } catch {
    return null
  }
  if (parseAdminKeys(env.GOVERNANCE_ADMIN_PUBLIC_KEYS, publicKeyHex).has(key)) return "admin"
  if (!isDbConfigured()) return null
  try {
    return await getGrantedRole(key)
  } catch {
    // Table missing (migration 011 not applied yet): nobody but env admins.
    return null
  }
}

type Moderator = {
  me: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  role: ModerationRole
  publicKey: string
  /** Shown in the public log: @handle, or a short address. */
  label: string
}

/** The signed-in moderator (or admin), or the error response to return. */
export async function requireRole(min: ModerationRole): Promise<Moderator | NextResponse> {
  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 })
  }
  const role = await roleFor(me.address)
  if (!roleAtLeast(role, min)) {
    return NextResponse.json(
      { ok: false, error: min === "admin" ? "Admins only." : "Moderators only." },
      { status: 403 },
    )
  }
  return {
    me,
    role: role!,
    publicKey: publicKeyHex(me.address),
    label: me.handle ? `@${me.handle}` : `${me.address.slice(0, 6)}…${me.address.slice(-4)}`,
  }
}

/**
 * /api/moderation/roles (admins)
 *
 *   GET     moderators and admins (env admins included, marked as such)
 *   POST    { address, role } grant or change a role
 *   DELETE  { address } revoke
 *
 * Roles are stored by public key, so they hold on every network prefix.
 * Admins from GOVERNANCE_ADMIN_PUBLIC_KEYS can't be revoked here.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { publicKeyHex, requireRole } from "@/lib/auth/roles"
import { initializeWasm, isValidSs58 } from "@/lib/chain/ss58"
import { grantRole, insertAction, listRoles, revokeRole } from "@/lib/db/moderation"
import { env } from "@/lib/env"
import { parseAdminKeys } from "@/lib/moderation/policy"

export const runtime = "nodejs"

const addressSchema = z.string().min(40).max(64)

export async function GET(): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  const envAdmins = [...parseAdminKeys(env.GOVERNANCE_ADMIN_PUBLIC_KEYS, publicKeyHex)]
  const rows = await listRoles().catch(() => [])
  return NextResponse.json(
    {
      ok: true,
      items: [
        ...envAdmins.map((k) => ({ public_key: k, role: "admin", fixed: true, created_at: null })),
        ...rows
          .filter((r) => !envAdmins.includes(r.public_key))
          .map((r) => ({
            public_key: r.public_key,
            role: r.role,
            fixed: false,
            created_at: r.created_at,
          })),
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

async function readAddress(request: NextRequest, withRole: boolean) {
  const schema = withRole
    ? z.object({ address: addressSchema, role: z.enum(["moderator", "admin"]) }).strict()
    : z.object({ address: addressSchema }).strict()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return null
  await initializeWasm()
  if (!isValidSs58(parsed.data.address)) return null
  return parsed.data as { address: string; role?: "moderator" | "admin" }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  const body = await readAddress(request, true)
  if (!body?.role)
    return NextResponse.json({ ok: false, error: "Enter a valid address." }, { status: 400 })
  const key = publicKeyHex(body.address)
  await grantRole(key, body.role, admin.publicKey)
  await insertAction({
    targetType: "role",
    targetId: key,
    proposalId: null,
    network: null,
    referendumIndex: null,
    action: "grant",
    reason: `${body.role} role for ${body.address.slice(0, 6)}…${body.address.slice(-4)}`,
    source: "moderator",
    actorPublicKey: admin.publicKey,
    actorLabel: admin.label,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  const body = await readAddress(request, false)
  if (!body)
    return NextResponse.json({ ok: false, error: "Enter a valid address." }, { status: 400 })
  const key = publicKeyHex(body.address)
  if (parseAdminKeys(env.GOVERNANCE_ADMIN_PUBLIC_KEYS, publicKeyHex).has(key)) {
    return NextResponse.json(
      { ok: false, error: "This admin is set in the server configuration." },
      { status: 409 },
    )
  }
  const removed = await revokeRole(key)
  if (removed) {
    await insertAction({
      targetType: "role",
      targetId: key,
      proposalId: null,
      network: null,
      referendumIndex: null,
      action: "revoke",
      reason: `role removed for ${body.address.slice(0, 6)}…${body.address.slice(-4)}`,
      source: "moderator",
      actorPublicKey: admin.publicKey,
      actorLabel: admin.label,
    })
  }
  return NextResponse.json({ ok: true, removed })
}

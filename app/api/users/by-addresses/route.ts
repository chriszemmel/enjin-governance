/**
 * POST /api/users/by-addresses
 *
 * Body: { addresses: string[] } - up to 100 entries.
 * Returns: { ok: true, users: PublicProfile[] } - only addresses with a
 * user row are present. Callers map by `user.address`.
 *
 * Avoids the N-request fan-out of `/api/users/by-address/[address]` when
 * a UI needs profiles for a list of accounts (wallet account picker,
 * comments author chips, etc.).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { isDbConfigured } from "@/lib/db/client"
import { getUsersByAddresses } from "@/lib/db/users"

export const runtime = "nodejs"

const MAX_ADDRESSES = 100

const bodySchema = z.object({
  addresses: z
    .array(z.string().min(4).max(64))
    .min(1)
    .max(MAX_ADDRESSES),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }

  let parsed
  try {
    const body = (await request.json()) as unknown
    parsed = bodySchema.safeParse(body)
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    )
  }
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid body" },
      { status: 400 },
    )
  }

  const unique = Array.from(new Set(parsed.data.addresses))
  const rows = await getUsersByAddresses(unique)
  return NextResponse.json({
    ok: true,
    users: rows.map((row) => ({
      id: row.id,
      address: row.address,
      handle: row.handle,
      display_name: row.display_name,
      bio: row.bio,
      avatar_url: row.avatar_url,
      is_verified:
        (row as unknown as { is_verified?: boolean }).is_verified ?? false,
      created_at: row.created_at,
    })),
  })
}

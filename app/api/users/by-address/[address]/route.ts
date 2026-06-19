import { NextResponse, type NextRequest } from "next/server"
import { isDbConfigured } from "@/lib/db/client"
import { getUserByAddress } from "@/lib/db/users"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ address: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }
  const { address } = await context.params
  if (!address || address.length < 4) {
    return NextResponse.json(
      { ok: false, error: "Invalid address" },
      { status: 400 },
    )
  }
  const row = await getUserByAddress(address)
  if (!row) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 })
  }
  const response = NextResponse.json({
    ok: true,
    user: {
      id: row.id,
      address: row.address,
      handle: row.handle,
      display_name: row.display_name,
      bio: row.bio,
      avatar_url: row.avatar_url,
      is_verified: (row as unknown as { is_verified?: boolean }).is_verified ?? false,
      created_at: row.created_at,
    },
  })
  response.headers.set(
    "cache-control",
    "public, s-maxage=60, stale-while-revalidate=600",
  )
  return response
}

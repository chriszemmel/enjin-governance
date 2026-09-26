/**
 * GET /api/proposals/by-proposer/[address]?network=<chain-id>
 *
 * Lists proposals filed by an SS58 address on a specific network.
 * Used by the create wizard to show "Your drafts" so the user can
 * cancel stuck ones (e.g. a Stage that never finalised).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { isDbConfigured } from "@/lib/db/client"
import { listProposalsByProposer } from "@/lib/db/proposals"

export const runtime = "nodejs"

const NETWORK_VALUES = [
  "enjin-relay",
  "enjin-matrix",
  "canary-relay",
  "canary-matrix",
] as const

export async function GET(
  request: NextRequest,
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

  const url = new URL(request.url)
  const network = z.enum(NETWORK_VALUES).safeParse(url.searchParams.get("network"))
  if (!network.success) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid `network` query param" },
      { status: 400 },
    )
  }

  const rows = await listProposalsByProposer(network.data, address)
  return NextResponse.json({
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      referendum_index: r.referendum_index,
      tx_hash: r.tx_hash,
      json_url: r.json_url,
      created_at: r.created_at,
      // Treasury drafts resume in the wizard; advanced ones carry no spend.
      is_treasury: r.amount_planck != null,
    })),
  })
}

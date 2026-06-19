/**
 * POST /api/proposals/by-indices
 *
 * Body: { network: NetworkId, indices: number[] } - up to 200 entries.
 * Returns: { ok: true, proposals: ProposalMetadata[] } - only indices
 * with a row in our mirror are present. Callers map by `referendum_index`.
 *
 * Avoids the N-request fan-out of `/api/proposals/by-index/[idx]` when
 * a list page renders many ProposalCards.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { isDbConfigured } from "@/lib/db/client"
import { getProposalsByIndices } from "@/lib/db/proposals"

export const runtime = "nodejs"

// Mirrors `listProposalsWithIndex`'s LIMIT 500 - there can never be more
// referenda in the on-chain list than the mirror tracks, so any list page
// can batch every visible card in a single request without chunking.
const MAX_INDICES = 500

const NETWORK_VALUES = [
  "enjin-relay",
  "enjin-matrix",
  "canary-relay",
  "canary-matrix",
] as const

const bodySchema = z.object({
  network: z.enum(NETWORK_VALUES),
  indices: z
    .array(z.number().int().nonnegative())
    .min(1)
    .max(MAX_INDICES),
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

  const unique = Array.from(new Set(parsed.data.indices))
  const rows = await getProposalsByIndices(parsed.data.network, unique)
  const response = NextResponse.json({
    ok: true,
    proposals: rows.map((row) => ({
      id: row.id,
      network: row.network,
      referendum_index: row.referendum_index,
      title: row.title,
      summary: row.summary,
      body_markdown: row.body_markdown,
      track: row.track,
      beneficiary: row.beneficiary,
      amount_planck: row.amount_planck,
      proposer_address: row.proposer_address,
      json_url: row.json_url,
      json_sha256: row.json_sha256,
      tx_hash: row.tx_hash,
      block_number: row.block_number,
      status: row.status,
      edited_at: row.edited_at,
      edit_count: row.edit_count,
      withdrawn_at: row.withdrawn_at,
      withdrawn_reason: row.withdrawn_reason,
      created_at: row.created_at,
    })),
  })
  // Mirrors the per-index route: edits land via PATCH and need to show
  // up on the next React Query invalidation, not after a CDN TTL.
  response.headers.set("cache-control", "private, no-cache, must-revalidate")
  return response
}

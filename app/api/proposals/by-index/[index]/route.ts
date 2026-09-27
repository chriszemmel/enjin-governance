/**
 * GET /api/proposals/by-index/[index]?network=<chain-id>
 *
 * Returns the off-chain metadata row for a referendum index, or 404
 * when no row exists (which is normal for proposals filed before this
 * system shipped - external indexers can still recover the JSON from
 * the chain via `referenda.metadataOf` or, for older referenda, by
 * decoding `system.remark` call args for the EGOV1 prefix).
 *
 * Not cached (`private, no-cache`): edits, withdrawals and moderation
 * should show on the next refetch.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { isDbConfigured } from "@/lib/db/client"
import { getProposalByIndex } from "@/lib/db/proposals"

export const runtime = "nodejs"

const NETWORK_VALUES = [
  "enjin-relay",
  "enjin-matrix",
  "canary-relay",
  "canary-matrix",
] as const

const networkSchema = z.enum(NETWORK_VALUES)
const indexSchema = z.coerce.number().int().nonnegative()

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ index: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }

  const { index: rawIndex } = await context.params
  const idx = indexSchema.safeParse(rawIndex)
  if (!idx.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid index" },
      { status: 400 },
    )
  }

  const url = new URL(request.url)
  const network = networkSchema.safeParse(url.searchParams.get("network"))
  if (!network.success) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid `network` query param" },
      { status: 400 },
    )
  }

  const row = await getProposalByIndex(network.data, idx.data)
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    )
  }

  const response = NextResponse.json({
    ok: true,
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
  })
  // Edits land via PATCH /api/proposals/[uuid] and we want the title +
  // (edited) chip + withdrawn banner to refresh on the next React
  // Query invalidation without waiting for a CDN TTL to elapse.
  response.headers.set("cache-control", "private, no-cache, must-revalidate")
  return response
}

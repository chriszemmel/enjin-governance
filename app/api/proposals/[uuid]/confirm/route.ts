/**
 * POST /api/proposals/[uuid]/confirm
 *
 * Called by the client AFTER the on-chain `utility.batchAll` finalises.
 * The client extracts the referendum_index from the `Referenda.Submitted`
 * event and posts it here so we can:
 *
 *   1. Flip the DB row status → 'on_chain' and lock in the on-chain coords.
 *   2. Write a tiny redirect file at `proposals/{network}/index/{index}.json`
 *      so an external indexer that only has the referendum index can
 *      resolve back to the canonical proposal.json without our database.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { initializeWasm, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import { attachReferendumIndex, getProposalById } from "@/lib/db/proposals"
import { isR2Configured } from "@/lib/r2/client"
import { proposalIndexRedirectKey } from "@/lib/r2/paths"
import { putJson } from "@/lib/r2/upload"

export const runtime = "nodejs"

const uuidSchema = z.string().uuid()

const bodySchema = z.object({
  referendum_index: z.number().int().nonnegative(),
  tx_hash: z.string().regex(/^0x[0-9a-f]{64}$/),
  block_hash: z.string().regex(/^0x[0-9a-f]{64}$/),
  block_number: z.number().int().nonnegative(),
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ uuid: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }

  const { uuid: rawUuid } = await context.params
  const uuidParse = uuidSchema.safeParse(rawUuid)
  if (!uuidParse.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid proposal uuid" },
      { status: 400 },
    )
  }
  const proposalUuid = uuidParse.data

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    )
  }

  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to confirm a proposal." },
      { status: 401 },
    )
  }

  const existing = await getProposalById(proposalUuid)
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Proposal not found" },
      { status: 404 },
    )
  }

  await initializeWasm()
  if (!samePublicKey(existing.proposer_address, me.address)) {
    return NextResponse.json(
      { ok: false, error: "Only the proposer can confirm this proposal." },
      { status: 403 },
    )
  }

  let row
  try {
    row = await attachReferendumIndex({
      proposalId: proposalUuid,
      referendumIndex: parsed.referendum_index,
      txHash: parsed.tx_hash,
      blockHash: parsed.block_hash,
      blockNumber: parsed.block_number,
    })
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `Db update failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    )
  }

  // Best-effort redirect blob - failure here is non-fatal; the DB row
  // still carries the index → json_url mapping.
  let redirectUrl: string | null = null
  if (isR2Configured()) {
    try {
      const redirectKey = proposalIndexRedirectKey(
        // The network values map 1:1 between R2 paths and the chain registry.
        row.network as "enjin-relay" | "enjin-matrix" | "canary-relay" | "canary-matrix",
        parsed.referendum_index,
      )
      const put = await putJson(redirectKey, {
        proposal_id: row.id,
        json_url: row.json_url,
        json_sha256: row.json_sha256,
        referendum_index: parsed.referendum_index,
        tx_hash: parsed.tx_hash,
        block_hash: parsed.block_hash,
        block_number: parsed.block_number,
      })
      redirectUrl = put.url
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    ok: true,
    id: row.id,
    referendum_index: row.referendum_index,
    json_url: row.json_url,
    redirect_url: redirectUrl,
    status: row.status,
  })
}

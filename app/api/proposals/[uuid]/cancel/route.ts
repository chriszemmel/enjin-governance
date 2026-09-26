/**
 * POST /api/proposals/[uuid]/cancel
 *
 * Marks a proposal row as 'cancelled' so it no longer shows as an
 * outstanding draft in lists. Idempotent - cancelling an already-
 * on_chain proposal is a no-op rather than an error, but `last_error`
 * gets a note explaining why we ignored the call (the proposal already
 * landed; cancelling it client-side wouldn't undo it).
 *
 * Body (optional): { reason?: string }
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { initializeWasm, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import { getProposalById, markProposalCancelled } from "@/lib/db/proposals"

export const runtime = "nodejs"

const uuidSchema = z.string().uuid()
const bodySchema = z
  .object({ reason: z.string().max(200).optional() })
  .optional()

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

  const { uuid: raw } = await context.params
  const parsed = uuidSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid proposal uuid" },
      { status: 400 },
    )
  }

  let body: { reason?: string } = {}
  try {
    const text = await request.text()
    if (text) {
      const json = JSON.parse(text)
      body = bodySchema.parse(json) ?? {}
    }
  } catch {
    // Empty/invalid body is fine.
  }

  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to cancel a proposal." },
      { status: 401 },
    )
  }

  const existing = await getProposalById(parsed.data)
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Proposal not found" },
      { status: 404 },
    )
  }

  await initializeWasm()
  if (!samePublicKey(existing.proposer_address, me.address)) {
    return NextResponse.json(
      { ok: false, error: "Only the proposer can cancel this proposal." },
      { status: 403 },
    )
  }
  if (existing.status === "on_chain") {
    return NextResponse.json(
      { ok: false, error: "Proposal is already on-chain - cancel is a no-op" },
      { status: 409 },
    )
  }

  const row = await markProposalCancelled(parsed.data, body.reason ?? null)
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Proposal is already on-chain - cancel is a no-op" },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true, id: row.id, status: row.status })
}

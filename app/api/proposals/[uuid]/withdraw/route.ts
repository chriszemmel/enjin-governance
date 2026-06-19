/**
 * POST /api/proposals/[uuid]/withdraw
 *
 * Proposer-driven off-chain withdrawal flag. The on-chain referendum
 * is untouched - Substrate's referenda.cancel() is gated to the
 * ReferendumCanceller origin, which the proposer doesn't have. What we
 * can do is set `withdrawn_at` so the detail page renders a "the
 * proposer asks voters to NAY this" banner.
 *
 * Body (optional): { reason?: string; undo?: boolean }
 *   - `reason`     : short note (≤ 280 chars) shown in the banner
 *   - `undo: true` : clears the flag (the proposer changed their mind)
 *
 * Auth: signed-in proposer, matched by public key (cross-prefix safe).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { initializeWasm, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import { getProposalById, setProposalWithdrawn } from "@/lib/db/proposals"

export const runtime = "nodejs"

const uuidSchema = z.string().uuid()
const bodySchema = z
  .object({
    reason: z.string().max(280).optional(),
    undo: z.boolean().optional(),
  })
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
  const idParse = uuidSchema.safeParse(raw)
  if (!idParse.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid proposal uuid" },
      { status: 400 },
    )
  }

  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to withdraw a proposal." },
      { status: 401 },
    )
  }

  const existing = await getProposalById(idParse.data)
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Proposal not found" },
      { status: 404 },
    )
  }

  await initializeWasm()
  if (!samePublicKey(existing.proposer_address, me.address)) {
    return NextResponse.json(
      { ok: false, error: "Only the proposer can withdraw this proposal." },
      { status: 403 },
    )
  }

  let body: { reason?: string; undo?: boolean } = {}
  try {
    const text = await request.text()
    if (text) {
      const json = JSON.parse(text)
      body = bodySchema.parse(json) ?? {}
    }
  } catch {
    // empty / invalid body → defaults
  }

  const row = await setProposalWithdrawn(
    existing.id,
    body.reason?.trim() || null,
    !body.undo,
  )

  return NextResponse.json({
    ok: true,
    id: row.id,
    withdrawn_at: row.withdrawn_at,
    withdrawn_reason: row.withdrawn_reason,
  })
}

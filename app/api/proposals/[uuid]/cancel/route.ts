/**
 * POST /api/proposals/[uuid]/cancel
 *
 * Marks a proposal row as 'cancelled' so it no longer shows as an
 * outstanding draft in lists. Refused (409) for an on_chain proposal -
 * cancelling it here wouldn't undo the referendum - and for a draft whose
 * envelope (from any staged version) is already on chain: its batch
 * landed but was never linked, and the drafts lists only offer the link
 * for an uncancelled draft. The chain check fails closed (503).
 *
 * Body (optional): { reason?: string }
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { initializeWasm, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import { getProposalById, markProposalCancelled } from "@/lib/db/proposals"
import { anyVersionOnChain, listVersionKeys } from "@/lib/governance/draft-versions"
import { isR2Configured } from "@/lib/r2/client"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

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

  const rl = await enforceRateLimit({ ...RATE_LIMITS.proposalCancel, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
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

  // Same check as DELETE: a draft whose batch landed (from any staged
  // version) must be linked to its referendum, and a cancelled one can't
  // be. Fails closed: if the versions or the chain can't be read, nothing
  // changes.
  try {
    const keys = isR2Configured() ? await listVersionKeys(existing) : [existing.json_key]
    if (await anyVersionOnChain(existing, keys)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This draft already reached the chain. Link it to its referendum from your drafts instead.",
        },
        { status: 409 },
      )
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach the chain to check this draft - try again." },
      { status: 503 },
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

/**
 * GET /api/proposals/[uuid]/json
 *
 * Server-side proxy for the proposal's canonical JSON in R2. Exists
 * because the R2 dev URL doesn't return `Access-Control-Allow-Origin`
 * by default, so browser fetches direct to the bucket fail with a CORS
 * error and the metadata header on `/proposals/[index]` can't verify
 * the sha256.
 *
 * The proxy:
 *   - Looks up the row by UUID to get the canonical `json_url`.
 *   - Fetches it server-side (no CORS) and streams the raw bytes back
 *     to the client so the browser can sha256-verify them.
 *   - Adds an `X-Proposal-Sha256` header carrying the hash we have on
 *     file, so the client can cross-check without a second round-trip.
 *
 * External indexers don't need this - they can fetch the bucket URL
 * directly. Only browser callers go through here.
 *
 * Proposals that haven't reached the chain are private: only their
 * proposer, signed in, can load them (to resume a draft).
 */

import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { initializeWasm, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import { getProposalById } from "@/lib/db/proposals"

export const runtime = "nodejs"

const uuidSchema = z.string().uuid()

export async function GET(
  _request: NextRequest,
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

  const row = await getProposalById(parsed.data)
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    )
  }
  if (row.status !== "on_chain") {
    const me = await getCurrentUser().catch(() => null)
    await initializeWasm()
    let own = false
    try {
      own = me != null && samePublicKey(me.address, row.proposer_address)
    } catch {
      own = false
    }
    if (!own) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 })
    }
  }

  // Proposer edits overwrite the bucket bytes at the same key, so
  // both Next's data cache for the upstream fetch and any downstream
  // cache have to skip stale entries. We let the browser do its own
  // dedupe via no-cache + must-revalidate instead.
  let upstream: Response
  try {
    upstream = await fetch(row.json_url, { cache: "no-store" })
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e)
    console.error("[proposals/json] upstream fetch failed", cause)
    return NextResponse.json(
      { ok: false, error: "The proposal file could not be read. Try again." },
      { status: 502 },
    )
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: `Upstream HTTP ${upstream.status}` },
      { status: 502 },
    )
  }

  const body = await upstream.arrayBuffer()
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-cache, must-revalidate",
      "x-proposal-sha256": row.json_sha256,
      // Lets the create page decide whether "Resume" can re-stage this row
      // in place (only unsigned drafts can).
      "x-proposal-status": row.status,
      "x-proposal-bucket-url": row.json_url,
    },
  })
}

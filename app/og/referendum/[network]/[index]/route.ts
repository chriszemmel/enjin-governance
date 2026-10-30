import { NextResponse } from "next/server"
import { CHAINS, type ChainId } from "@/lib/chain/chains"
import { renderReferendumCard } from "@/lib/og/referendum-card"
import { loadReferendumCard } from "@/lib/og/referendum-data"
import { parseReferendumIndex } from "@/lib/seo/site"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

/**
 * GET /og/referendum/[network]/[index]: the share image of one referendum.
 *
 * The network is part of the path (unlike a route's opengraph-image) so a
 * Canary page's preview shows the Canary referendum. The image holds only
 * stable facts, but its title can change: moderators may hide it or the
 * proposer edit it. So the CDN keeps it for 15 minutes (and serves the old
 * one for up to an hour while it redraws), not a day. A card the chain
 * couldn't fill in time is kept for five minutes only.
 */
export async function GET(_req: Request, context: { params: Promise<{ network: string; index: string }> }) {
  const { network, index: rawIndex } = await context.params
  const chain = Object.hasOwn(CHAINS, network) ? CHAINS[network as ChainId] : null
  // Only the canonical form ("15", not "015" or "1.5e1"): one cache entry each.
  const index = /^(0|[1-9]\d*)$/.test(rawIndex) ? parseReferendumIndex(rawIndex) : null
  if (!chain?.enabled || index == null) {
    return NextResponse.json({ error: "Unknown referendum" }, { status: 404 })
  }
  const card = await loadReferendumCard(chain, index)
  return renderReferendumCard(card, {
    "Cache-Control": card.complete
      ? "public, max-age=300, s-maxage=900, stale-while-revalidate=3600"
      : "public, max-age=60, s-maxage=300",
  })
}

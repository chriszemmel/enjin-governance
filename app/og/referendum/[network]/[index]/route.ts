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
 * stable facts, so the CDN keeps it for a day; one read of the database and
 * the chain per referendum and day. A card the chain couldn't fill in time
 * is kept for five minutes only.
 */
export async function GET(_req: Request, context: { params: Promise<{ network: string; index: string }> }) {
  const { network, index: rawIndex } = await context.params
  const chain = network in CHAINS ? CHAINS[network as ChainId] : null
  // Only the canonical form ("15", not "015" or "1.5e1"): one cache entry each.
  const index = /^(0|[1-9]\d*)$/.test(rawIndex) ? parseReferendumIndex(rawIndex) : null
  if (!chain?.enabled || index == null) {
    return NextResponse.json({ error: "Unknown referendum" }, { status: 404 })
  }
  const card = await loadReferendumCard(chain, index)
  return renderReferendumCard(card, {
    "Cache-Control": card.complete
      ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400"
      : "public, max-age=60, s-maxage=300",
  })
}

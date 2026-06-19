import { NextResponse } from "next/server"
import { type ChainId, CHAINS } from "@/lib/chain/chains"
import { fetchSubscanReferendum } from "@/lib/subscan/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  context: { params: Promise<{ chain: string; index: string }> },
) {
  const { chain, index } = await context.params
  if (!(chain in CHAINS)) {
    return NextResponse.json({ error: "Unknown chain" }, { status: 400 })
  }
  const idx = Number(index)
  if (!Number.isInteger(idx) || idx < 0) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 })
  }
  const data = await fetchSubscanReferendum(chain as ChainId, idx)
  if (!data) {
    return NextResponse.json({ data: null }, { status: 404 })
  }
  // Terminal referenda are immutable; ongoing ones change slowly. Subscan
  // has a 5 req/sec hard limit so we cache aggressively at the CDN -
  // 5 min fresh, 1 hour stale-while-revalidate.
  const cacheTtl = isTerminal(data.status) ? "s-maxage=86400" : "s-maxage=300"
  return NextResponse.json(
    { data },
    {
      headers: {
        "Cache-Control": `public, ${cacheTtl}, stale-while-revalidate=3600`,
      },
    },
  )
}

function isTerminal(status: string | undefined): boolean {
  if (!status) return false
  return /^(executed|approved|rejected|cancelled|timedout|killed)$/i.test(status)
}

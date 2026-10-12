import { NextResponse } from "next/server"
import { type ChainId, CHAINS } from "@/lib/chain/chains"
import { fetchSubscanVotes } from "@/lib/subscan/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  context: { params: Promise<{ chain: string; index: string }> },
) {
  const { chain, index } = await context.params
  if (!Object.hasOwn(CHAINS, chain)) {
    return NextResponse.json({ error: "Unknown chain" }, { status: 400 })
  }
  const idx = Number(index)
  if (!Number.isInteger(idx) || idx < 0) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 })
  }
  const votes = await fetchSubscanVotes(chain as ChainId, idx)
  if (!votes) {
    return NextResponse.json({ data: null }, { status: 404 })
  }
  // Vote rows include bigint balances - JSON.stringify can't serialize
  // bigint directly, so coerce to strings at the route boundary.
  const serialised = votes.map((v) => ({
    ...v,
    balance: v.balance.toString(),
  }))
  return NextResponse.json(
    { data: serialised },
    {
      headers: {
        // Vote rows for a referendum are append-only. Subscan caps at
        // 5 req/sec so we cache hard at the CDN - 5 min fresh, 1 hour
        // stale-while-revalidate. Terminal referenda's votes are
        // immutable so the SWR window is fine.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  )
}

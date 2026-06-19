import { NextResponse } from "next/server"
import { type ChainId, CHAINS } from "@/lib/chain/chains"
import { fetchSubscanPreimage } from "@/lib/subscan/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  context: { params: Promise<{ chain: string; hash: string }> },
) {
  const { chain, hash } = await context.params
  if (!(chain in CHAINS)) {
    return NextResponse.json({ error: "Unknown chain" }, { status: 400 })
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return NextResponse.json({ error: "Invalid hash" }, { status: 400 })
  }
  const data = await fetchSubscanPreimage(chain as ChainId, hash)
  if (!data) {
    return NextResponse.json({ data: null }, { status: 404 })
  }
  return NextResponse.json(
    { data },
    {
      headers: {
        // Preimage call bytes are immutable once noted. Keep cached aggressively.
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  )
}

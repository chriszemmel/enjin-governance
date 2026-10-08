import { unstable_cache } from "next/cache"
import { NextResponse } from "next/server"
import { getApi } from "@/lib/chain/api"
import { CHAINS, type ChainId } from "@/lib/chain/chains"
import { getDecidedTrack, listReferenda } from "@/lib/governance/referenda"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Stop reading new tracks after this long; the next request carries on. */
const BUDGET_MS = 40_000

/**
 * The tracks of every decided referendum on a chain, as `{ index: track }`.
 *
 * The chain drops a referendum's track once it's decided, so it's read from
 * the archive at the block before the decision (`getDecidedTrack`). That
 * never changes, so each one is kept in the data cache for good and read
 * once per chain, one at a time - the archive answers single reads quickly
 * but slows down under a burst. The response is cached at the CDN, so
 * visitors get it without any archive read of their own.
 *
 * `complete: false` means some couldn't be read in time; that response
 * isn't cached and the browser reads the rest itself.
 */
export async function GET(_req: Request, context: { params: Promise<{ chain: string }> }) {
  const { chain: chainId } = await context.params
  if (!Object.hasOwn(CHAINS, chainId)) {
    return NextResponse.json({ error: "Unknown chain" }, { status: 400 })
  }
  const chain = CHAINS[chainId as ChainId]

  let referenda
  try {
    referenda = await listReferenda(await getApi(chain.rpc, 0))
  } catch {
    return NextResponse.json({ error: "Chain unavailable" }, { status: 503 })
  }
  const decided = referenda
    .flatMap((r) => (r.status.type !== "Ongoing" && r.status.at > 1 ? [{ index: r.index, at: r.status.at }] : []))
    .sort((a, b) => a.index - b.index)

  const started = Date.now()
  const tracks: Record<number, number> = {}
  let complete = true
  for (const d of decided) {
    if (Date.now() - started > BUDGET_MS) {
      complete = false
      break
    }
    try {
      tracks[d.index] = await cachedTrack(chainId, d.index, d.at)
    } catch {
      complete = false
    }
  }

  return NextResponse.json(
    { tracks, complete },
    {
      headers: {
        "Cache-Control": complete
          ? "public, s-maxage=600, stale-while-revalidate=86400"
          : "no-store",
      },
    },
  )
}

/**
 * One referendum's track, cached for good under its index and decision
 * block. A failed read throws, so it isn't cached and is tried again.
 */
function cachedTrack(chainId: string, index: number, at: number): Promise<number> {
  return unstable_cache(
    async () => {
      const chain = CHAINS[chainId as ChainId]
      const archive = await getApi(chain.archiveRpc ?? chain.rpc, 0)
      const track = await getDecidedTrack(archive, index, at)
      if (track == null) throw new Error(`No track for referendum ${index}`)
      return track
    },
    ["decided-track", chainId, String(index), String(at)],
    { revalidate: false },
  )()
}

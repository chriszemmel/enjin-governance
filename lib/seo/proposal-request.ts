/**
 * Request facts the referendum layout and page share: which referendum the
 * URL names, and whether a crawler is asking.
 */

import "server-only"
import { headers } from "next/headers"
import { userAgent } from "next/server"
import { NETWORK_HINT_HEADER } from "./network-hint"
import { chainFromHint, parseReferendumIndex } from "./site"

/** Which referendum: the URL segment, and the chain from `?network=` (via proxy.ts). */
export async function proposalTarget(params: Promise<{ index: string }>) {
  const { index } = await params
  const chain = chainFromHint((await headers()).get(NETWORK_HINT_HEADER))
  return { index: parseReferendumIndex(index), chain }
}

/**
 * Browsers get the page shell at once and the parts that wait for the
 * database streamed in after it. Crawlers get those parts in place: they
 * already wait for the same read for the metadata, and some don't run the
 * script that moves streamed parts into position.
 */
export async function isCrawlerRequest(): Promise<boolean> {
  return userAgent({ headers: await headers() }).isBot
}

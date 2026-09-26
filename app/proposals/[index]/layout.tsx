import type { Metadata } from "next"
import { headers } from "next/headers"
import { userAgent } from "next/server"
import { Suspense } from "react"
import { INVALID_PROPOSAL_METADATA, proposalMetadata } from "@/lib/seo/metadata"
import { NETWORK_HINT_HEADER } from "@/lib/seo/network-hint"
import { loadProposalSeo } from "@/lib/seo/proposal"
import { ProposalSeoFallback } from "@/lib/seo/proposal-fallback"
import { chainFromHint, parseReferendumIndex } from "@/lib/seo/site"

type Props = { params: Promise<{ index: string }> }

/**
 * The page reads the referendum from the chain in the browser, so the
 * server has nothing to show until then. This layout gives it what the
 * server does know - the published title, summary, proposer and withdrawal
 * from our database - as metadata, structured data and a no-JavaScript
 * fallback. The page itself is unchanged.
 */

/** Which referendum: the URL segment, and the chain from `?network=` (via proxy.ts). */
async function target(params: Props["params"]) {
  const { index } = await params
  const chain = chainFromHint((await headers()).get(NETWORK_HINT_HEADER))
  return { index: parseReferendumIndex(index), chain }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { index, chain } = await target(params)
  if (index == null) return INVALID_PROPOSAL_METADATA
  return proposalMetadata(await loadProposalSeo(chain.id, index))
}

export default async function ProposalLayout({
  children,
  params,
}: Props & { children: React.ReactNode }) {
  const { index, chain } = await target(params)
  if (index == null) return children

  const fallback = <ProposalSeoFallback chainId={chain.id} index={index} />
  // Browsers get the page shell at once and this part streamed in after
  // the (short, bounded) database read. Crawlers get it in place: they
  // already wait for the same read for the metadata, and some don't run
  // the script that moves streamed parts into position.
  const isCrawler = userAgent({ headers: await headers() }).isBot
  return (
    <>
      {isCrawler ? fallback : <Suspense fallback={null}>{fallback}</Suspense>}
      {children}
    </>
  )
}

import type { Metadata } from "next"
import { Suspense } from "react"
import { settleWithin } from "@/lib/seo/deadline"
import { INVALID_PROPOSAL_METADATA, proposalMetadata } from "@/lib/seo/metadata"
import { loadProposalSeo } from "@/lib/seo/proposal"
import { ProposalSeoFallback } from "@/lib/seo/proposal-fallback"
import { proposalPreview } from "@/lib/seo/proposal-preview"
import { ProposalPreviewProvider } from "@/lib/seo/proposal-preview-context"
import { isCrawlerRequest, proposalTarget } from "@/lib/seo/proposal-request"

type Props = { params: Promise<{ index: string }> }

/**
 * How long browsers' pages wait for the header's text. A quick read makes
 * it part of the first paint (no text popping in and pushing the page
 * down); a slower one streams in rather than holding the page up.
 */
const PREVIEW_WAIT_MS = 300

/**
 * The page reads the referendum from the chain in the browser. This layout
 * gives it what the server does know - the published title, summary,
 * proposer and withdrawal from our database - as metadata, structured data,
 * a note for visitors without JavaScript, and the text the page's header
 * shows before the chain answers (proposal-preview.ts).
 */

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { index, chain } = await proposalTarget(params)
  if (index == null) return INVALID_PROPOSAL_METADATA
  return proposalMetadata(await loadProposalSeo(chain.id, index))
}

export default async function ProposalLayout({
  children,
  params,
}: Props & { children: React.ReactNode }) {
  const { index, chain } = await proposalTarget(params)
  if (index == null) return children

  // The metadata, the note and the header's text share one (per-request)
  // database read. The note streams to browsers; crawlers get it and the
  // header's text in place (see isCrawlerRequest).
  const crawler = await isCrawlerRequest()
  const fallback = <ProposalSeoFallback chainId={chain.id} index={index} />
  const read = loadProposalSeo(chain.id, index).then(proposalPreview)
  const preview = crawler ? { value: await read } : await settleWithin(read, PREVIEW_WAIT_MS)
  return (
    <>
      {crawler ? fallback : <Suspense fallback={null}>{fallback}</Suspense>}
      <ProposalPreviewProvider preview={"value" in preview ? preview.value : preview.pending}>
        {children}
      </ProposalPreviewProvider>
    </>
  )
}

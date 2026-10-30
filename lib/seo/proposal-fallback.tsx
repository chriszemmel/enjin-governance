import { subscanReferendumUrl, type ChainId } from "@/lib/chain/chains"
import { JsonLd, proposalJsonLd } from "./json-ld"
import { loadProposalSeo } from "./proposal"

/**
 * The server-rendered part of a referendum page besides its header: the
 * structured data and, for visitors without JavaScript, what we know of the
 * referendum and where its live state can be read. The page's own HTML
 * streams the heading, the summary and the proposer (see
 * proposal-preview.ts), which without scripts may never move into place,
 * so the note repeats the title and summary, as a paragraph, not an <h1>.
 */
export async function ProposalSeoFallback({ chainId, index }: { chainId: ChainId; index: number }) {
  const p = await loadProposalSeo(chainId, index)
  return (
    <>
      <JsonLd data={proposalJsonLd(p)} />
      <noscript>
        <section className="mx-auto max-w-5xl px-4 pt-24 sm:px-6 lg:px-8">
          {p.title && <p className="text-lg font-semibold text-foreground">{p.title}</p>}
          {p.summary && <p className="mt-2 text-sm text-muted-foreground">{p.summary}</p>}
          <p className="mt-3 text-sm text-muted-foreground">
            Referendum #{p.index} on the {p.chain.name}
            {p.proposer && <>, proposed by {p.proposer.name ?? p.proposer.address}</>}
            {p.withdrawn && <>. The proposer has withdrawn it; voting stays open on chain</>}.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            The live status, tally and votes are read from the chain in your browser, which needs
            JavaScript.{" "}
            <a href={subscanReferendumUrl(p.chain, p.index)} className="underline">
              View referendum #{p.index} on Subscan
            </a>
            .
          </p>
        </section>
      </noscript>
    </>
  )
}

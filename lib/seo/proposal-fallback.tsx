import { subscanReferendumUrl, type ChainId } from "@/lib/chain/chains"
import { JsonLd, proposalJsonLd } from "./json-ld"
import { proposalTitle } from "./metadata"
import { loadProposalSeo } from "./proposal"

/**
 * The server-rendered part of a referendum page: its structured data and,
 * for crawlers and visitors without JavaScript, the title, summary and what
 * we know of its status. With JavaScript the <noscript> block never shows -
 * the page renders the same facts itself once it has read the chain.
 */
export async function ProposalSeoFallback({ chainId, index }: { chainId: ChainId; index: number }) {
  const p = await loadProposalSeo(chainId, index)
  return (
    <>
      <JsonLd data={proposalJsonLd(p)} />
      <noscript>
        <section className="mx-auto max-w-5xl px-4 pt-24 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-semibold text-foreground break-words">{proposalTitle(p)}</h1>
          {p.summary && (
            <p className="mt-2 text-muted-foreground [overflow-wrap:anywhere]">{p.summary}</p>
          )}
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

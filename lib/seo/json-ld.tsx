/**
 * Structured data (schema.org JSON-LD). Only facts the site actually has:
 * no ratings, no invented dates, no organisation it doesn't represent.
 */

import { APP_DESCRIPTION, APP_NAME } from "@/lib/config"
import { env } from "@/lib/env"
import { clip, proposalTitle, toIso } from "./metadata"
import type { ProposalSeo } from "./proposal"
import { absoluteUrl } from "./site"

type JsonLdNode = Record<string, unknown>
type JsonLdGraph = { "@context": "https://schema.org"; "@graph": JsonLdNode[] }

const graph = (nodes: JsonLdNode[]): JsonLdGraph => ({
  "@context": "https://schema.org",
  "@graph": nodes,
})

const websiteId = () => `${absoluteUrl("/")}#website`

/**
 * The site and who publishes it: the maintainer named in the footer. This is
 * an independent interface, so it never claims to be Enjin's own site.
 */
export function siteJsonLd(): JsonLdGraph {
  const home = absoluteUrl("/")
  return graph([
    {
      "@type": "WebSite",
      "@id": websiteId(),
      url: home,
      name: APP_NAME,
      description: APP_DESCRIPTION,
      inLanguage: "en",
      publisher: { "@id": `${home}#publisher` },
    },
    {
      "@type": "Person",
      "@id": `${home}#publisher`,
      name: env.NEXT_PUBLIC_SITE_MAINTAINER,
    },
  ])
}

/**
 * Breadcrumbs for every referendum page, plus an Article for the proposal
 * text when one was published here. There is no publication date: we know
 * when the text was written and last edited, not when the referendum was
 * submitted.
 */
export function proposalJsonLd(p: ProposalSeo): JsonLdGraph {
  const url = absoluteUrl(p.path)
  const breadcrumbs: JsonLdNode = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Proposals", item: absoluteUrl("/proposals") },
      { "@type": "ListItem", position: 3, name: proposalTitle(p), item: url },
    ],
  }
  if (!p.title) return graph([breadcrumbs])

  const article: JsonLdNode = {
    "@type": "Article",
    "@id": `${url}#proposal`,
    // Google shows up to 110 characters of a headline.
    headline: clip(p.title, 110),
    url,
    mainEntityOfPage: url,
    inLanguage: "en",
    isPartOf: { "@id": websiteId() },
  }
  if (p.summary) article.description = p.summary
  if (p.createdAt) article.dateCreated = toIso(p.createdAt)
  if (p.editedAt) article.dateModified = toIso(p.editedAt)
  if (p.proposer) {
    article.author = {
      "@type": "Person",
      name: p.proposer.name ?? p.proposer.address,
      identifier: p.proposer.address,
      url: absoluteUrl(`/user/${encodeURIComponent(p.proposer.address)}`),
    }
  }
  return graph([breadcrumbs, article])
}

/**
 * JSON for a <script> element. Titles and names are user text, so "<" and
 * friends are escaped: a title containing "</script>" can't end the element.
 */
export function serializeJsonLd(data: JsonLdGraph): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

export function JsonLd({ data }: { data: JsonLdGraph }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}

/**
 * Page metadata builders. Pages only set a title, a description and their
 * canonical path; Open Graph and Twitter titles, descriptions and images
 * follow from those and the route's opengraph-image (see app/layout.tsx).
 * A referendum's page names its own card (/og/referendum/[network]/[index]).
 */

import type { Metadata } from "next"
import { APP_NAME } from "@/lib/config"
import type { ProposalSeo } from "./proposal"

export const TITLE_TEMPLATE = `%s | ${APP_NAME}`

/** Open Graph fields every page shares. */
export const OPEN_GRAPH_BASE = {
  type: "website",
  locale: "en_US",
  siteName: APP_NAME,
} as const

/** Search engines show about 155-160 characters of a description. */
const DESCRIPTION_MAX = 160

/** Shorten to at most `max` characters, at a word boundary where there is one. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:-]+$/, "")}…`
}

/**
 * Title, description and canonical URL of a public page. The title keeps
 * the site-wide template for pages below this one.
 */
export function pageMetadata(page: { title: string; description: string; path: string }): Metadata {
  return {
    title: { default: page.title, template: TITLE_TEMPLATE },
    description: clip(page.description, DESCRIPTION_MAX),
    alternates: { canonical: page.path },
  }
}

/** The page title of a referendum: its published title, else its number. */
export function proposalTitle(p: ProposalSeo): string {
  return p.title ?? `Referendum #${p.index}`
}

export function proposalDescription(p: ProposalSeo): string {
  const lead = p.withdrawn ? "Withdrawn by the proposer. " : ""
  const text =
    p.summary ??
    `Referendum #${p.index} on the ${p.chain.name}: live status, tally, votes and the proposed call.`
  return clip(lead + text, DESCRIPTION_MAX)
}

/** The share image of one referendum, with its network in the path. */
function proposalImagePath(p: Pick<ProposalSeo, "index" | "chain">): string {
  return `/og/referendum/${p.chain.id}/${p.index}`
}

export function proposalMetadata(p: ProposalSeo): Metadata {
  const image = {
    url: proposalImagePath(p),
    width: 1200,
    height: 630,
    alt: `${proposalTitle(p)} · ${APP_NAME}`,
  }
  return {
    title: { default: proposalTitle(p), template: TITLE_TEMPLATE },
    description: proposalDescription(p),
    alternates: { canonical: p.path },
    // Setting openGraph replaces the site-wide one, so the shared fields
    // come along; Next still fills in the title and description. The image
    // is the referendum's own card, on its network (a route's
    // opengraph-image can't see `?network=`).
    openGraph: {
      ...OPEN_GRAPH_BASE,
      type: "article",
      images: [image],
      ...(p.editedAt ? { modifiedTime: toIso(p.editedAt) } : {}),
    },
    twitter: { card: "summary_large_image", images: [image] },
    // Another network's pages can be shared but stay out of the index: the
    // sitemap and canonical URLs cover the default network, and the same
    // number there is a different referendum.
    ...(p.isDefaultNetwork ? {} : { robots: { index: false, follow: true } }),
  }
}

/** For `/proposals/<segment>` that isn't a referendum number. */
export const INVALID_PROPOSAL_METADATA: Metadata = {
  title: "Referendum not found",
  robots: { index: false, follow: true },
}

export function toIso(value: Date | string): string | undefined {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

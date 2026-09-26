/**
 * What a referendum page can say about itself before the browser has read
 * the chain: the published title and summary from our database, who
 * proposed it and whether they withdrew it. Used by the proposal layout for
 * its metadata, structured data and no-JavaScript fallback.
 *
 * Best effort and bounded: without a database, on an error or past the time
 * budget, the page falls back to "Referendum #n" and nothing is thrown.
 */

import "server-only"
import { cache } from "react"
import { CHAINS, type ChainConfig, type ChainId } from "@/lib/chain/chains"
import { isDbConfigured } from "@/lib/db/client"
import { getState } from "@/lib/db/moderation"
import { getProposalByIndex } from "@/lib/db/proposals"
import { getUserByAddress } from "@/lib/db/users"
import { withDeadline } from "./deadline"
import { defaultChain, proposalPath } from "./site"

export type ProposalSeo = {
  index: number
  chain: ChainConfig
  isDefaultNetwork: boolean
  /** Canonical path; another network's page keeps its `?network=`. */
  path: string
  /** Published title; null without one or while moderators hide the proposal. */
  title: string | null
  summary: string | null
  proposer: { address: string; name: string | null } | null
  /** When the proposal text was created (not when the referendum was submitted). */
  createdAt: Date | null
  /** Last edit of the text by its proposer, if any. */
  editedAt: Date | null
  withdrawn: boolean
}

/** Metadata is streamed to browsers, but crawlers wait for it. */
const DB_BUDGET_MS = 1_500

/**
 * Memoised per request, so the layout's metadata and body share one read.
 */
export const loadProposalSeo = cache(
  async (chainId: ChainId, index: number): Promise<ProposalSeo> => {
    const chain = CHAINS[chainId]
    const base: ProposalSeo = {
      index,
      chain,
      isDefaultNetwork: chain.id === defaultChain().id,
      path: proposalPath(index, chain),
      title: null,
      summary: null,
      proposer: null,
      createdAt: null,
      editedAt: null,
      withdrawn: false,
    }
    if (!isDbConfigured()) return base
    try {
      return await withDeadline(readProposal(base), DB_BUDGET_MS)
    } catch {
      return base
    }
  },
)

async function readProposal(base: ProposalSeo): Promise<ProposalSeo> {
  const row = await getProposalByIndex(base.chain.id, base.index)
  // Only text that reached the chain is public.
  if (!row || row.status !== "on_chain") return base
  const [state, user] = await Promise.all([
    // The moderation table may not exist yet (migration 011); treat as visible,
    // like /api/moderation/state does.
    getState("proposal", row.id).catch(() => null),
    getUserByAddress(row.proposer_address).catch(() => null),
  ])
  const name = user?.display_name?.trim() || (user?.handle ? `@${user.handle}` : null) || null
  const withdrawn = row.withdrawn_at != null
  const proposer = { address: row.proposer_address, name }
  // Moderators hid it: keep its words out of search results and link previews.
  if (state?.state === "hidden" || state?.state === "removed") {
    return { ...base, proposer, withdrawn }
  }
  return {
    ...base,
    title: row.title.trim() || null,
    summary: row.summary?.trim() || null,
    proposer,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    withdrawn,
  }
}

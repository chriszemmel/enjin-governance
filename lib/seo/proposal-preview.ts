/**
 * The text at the top of a referendum page - title, summary, proposer and
 * withdrawal - before the browser has read anything. The server has it from
 * the same database read as the page's metadata (loadProposalSeo) and hands
 * it to the page, so it shows at once; the page's own read of
 * /api/proposals/by-index takes over when it answers.
 */

import type { ChainId } from "@/lib/chain/chains"
import type { ProposalMetadata } from "@/lib/query/hooks/use-proposal-metadata"
import type { ProposalSeo } from "./proposal"

export type ProposalPreview = {
  chainId: ChainId
  index: number
  title: string
  summary: string | null
  proposer: { address: string; name: string | null } | null
  edited: boolean
  withdrawn: { reason: string | null } | null
}

/**
 * None without a published title: no text reached the chain, the database
 * is unset or was too slow, or moderators hid the proposal. A hidden
 * proposal's words are never in loadProposalSeo's answer, so they can't end
 * up in the page's HTML either.
 */
export function proposalPreview(p: ProposalSeo): ProposalPreview | null {
  if (!p.title) return null
  return {
    chainId: p.chain.id,
    index: p.index,
    title: p.title,
    summary: p.summary,
    proposer: p.proposer,
    edited: p.editedAt != null,
    withdrawn: p.withdrawn ? { reason: p.withdrawnReason } : null,
  }
}

type ProposalHeaderText = {
  /** Null without a published title: the page shows "Referendum #n". */
  title: string | null
  summary: string | null
  edited: boolean
  withdrawn: { reason: string | null } | null
  proposer: { address: string; name: string | null } | null
}

/**
 * The header's text from whichever source has it. `metadata` is the
 * browser's read: undefined until it answers (or when it failed without an
 * earlier answer), null when the referendum has no published text. It wins
 * once there, since it carries later edits. "pending" while neither source
 * has answered, so a titled proposal doesn't flash "Referendum #n" first.
 */
export function proposalHeaderText(
  metadata: ProposalMetadata | null | undefined,
  preview: ProposalPreview | null,
  metadataPending: boolean,
): ProposalHeaderText | "pending" {
  if (metadata) {
    const proposer = metadata.proposer_address
    return {
      title: metadata.title,
      summary: metadata.summary,
      edited: metadata.edited_at != null,
      withdrawn: metadata.withdrawn_at ? { reason: metadata.withdrawn_reason } : null,
      proposer: {
        address: proposer,
        // Only the server looked the name up; the browser's read has none.
        name: preview?.proposer?.address === proposer ? preview.proposer.name : null,
      },
    }
  }
  if (metadata === null) {
    return { title: null, summary: null, edited: false, withdrawn: null, proposer: null }
  }
  if (preview) {
    const { title, summary, edited, withdrawn, proposer } = preview
    return { title, summary, edited, withdrawn, proposer }
  }
  if (metadataPending) return "pending"
  return { title: null, summary: null, edited: false, withdrawn: null, proposer: null }
}

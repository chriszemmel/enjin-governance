/**
 * Resolve a moderation target (proposal id, attachment bucket key or
 * comment id) to the proposal it belongs to. Returns null for anything
 * that doesn't exist, so reports and actions can't be filed against
 * made-up ids.
 */

import "server-only"
import { getCommentById } from "@/lib/db/comments"
import { getProposalById, type ProposalRow } from "@/lib/db/proposals"
import { ownMediaKey } from "@/lib/r2/paths"
import { parseMediaKey, type ModerationTarget } from "./policy"

type ResolvedTarget = {
  type: ModerationTarget
  id: string
  proposal: ProposalRow
  /** Author of a comment (for suspensions). */
  authorUserId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function resolveTarget(
  type: ModerationTarget,
  id: string,
): Promise<ResolvedTarget | null> {
  if (type === "proposal") {
    if (!UUID.test(id)) return null
    const proposal = await getProposalById(id)
    return proposal ? { type, id, proposal, authorUserId: proposal.proposer_user_id ?? null } : null
  }
  if (type === "attachment") {
    const parsed = parseMediaKey(id)
    if (!parsed || !ownMediaKey(id, parsed.network, parsed.proposalId)) return null
    const proposal = await getProposalById(parsed.proposalId)
    if (!proposal || proposal.network !== parsed.network) return null
    return { type, id, proposal, authorUserId: proposal.proposer_user_id ?? null }
  }
  if (!UUID.test(id)) return null
  const comment = await getCommentById(id)
  if (!comment) return null
  const proposal = await getProposalById(comment.proposal_id)
  return proposal ? { type, id, proposal, authorUserId: comment.user_id } : null
}

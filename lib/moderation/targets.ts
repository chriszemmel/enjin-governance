/**
 * Resolve a moderation target (proposal id, attachment bucket key or
 * comment id) to what it belongs to. Returns null for anything that
 * doesn't exist, so reports and actions can't be filed against made-up
 * ids. Ids come back in their stored form (lower-case uuids), so every
 * state row matches what the rest of the app looks up.
 *
 * An upload whose draft was never saved has no proposal row; it still
 * resolves (by its folder) while the file exists, so it can be reported,
 * hidden or deleted like any other.
 */

import "server-only"
import { getCommentById } from "@/lib/db/comments"
import { getProposalById, type ProposalRow } from "@/lib/db/proposals"
import { ownMediaKey } from "@/lib/r2/paths"
import { objectExists } from "@/lib/r2/upload"
import { parseMediaKey, type ModerationTarget } from "./policy"

type ResolvedTarget = {
  type: ModerationTarget
  id: string
  /** Null only for an upload whose draft was never saved. */
  proposal: ProposalRow | null
  network: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function resolveTarget(
  type: ModerationTarget,
  rawId: string,
): Promise<ResolvedTarget | null> {
  if (type === "proposal") {
    if (!UUID.test(rawId)) return null
    const proposal = await getProposalById(rawId.toLowerCase())
    return proposal ? { type, id: proposal.id, proposal, network: proposal.network } : null
  }
  if (type === "attachment") {
    const parsed = parseMediaKey(rawId)
    const key = parsed ? ownMediaKey(rawId, parsed.network, parsed.proposalId) : null
    if (!parsed || !key) return null
    const proposal = await getProposalById(parsed.proposalId)
    if (proposal) {
      return proposal.network === parsed.network
        ? { type, id: key, proposal, network: proposal.network }
        : null
    }
    return (await objectExists(key).catch(() => false))
      ? { type, id: key, proposal: null, network: parsed.network }
      : null
  }
  if (!UUID.test(rawId)) return null
  const comment = await getCommentById(rawId.toLowerCase())
  if (!comment) return null
  const proposal = await getProposalById(comment.proposal_id)
  return proposal ? { type, id: comment.id, proposal, network: proposal.network } : null
}

/**
 * The proposal API answers with what the page shows: the text of a proposal
 * that moderators hid or removed is left out, as the comments route does for
 * comments. The pinned EGOV1 JSON under /r stays public by design, since its
 * hash is on chain.
 */

import "server-only"
import { listProposalTextStates } from "@/lib/db/moderation"
import { isMissingTable } from "@/lib/db/errors"
import type { ModerationStateValue } from "@/lib/moderation/policy"

type TextState = { state: ModerationStateValue; reason: string | null }

/**
 * Moderation states of these proposals' text, by proposal id; only the
 * non-visible ones. Null when they couldn't be read: the caller answers 503
 * rather than show something that may be hidden.
 */
export async function proposalTextStates(ids: string[]): Promise<Map<string, TextState> | null> {
  try {
    const rows = await listProposalTextStates(ids)
    return new Map(rows.map((r) => [r.target_id, { state: r.state, reason: r.reason }]))
  } catch (err) {
    // Migration 011 not applied yet: nothing is moderated.
    return isMissingTable(err) ? new Map() : null
  }
}

/** The row's text, or nothing when its state keeps it off the page. */
export function visibleText(
  row: { title: string | null; summary: string | null; body_markdown: string },
  state: TextState | undefined,
): { title: string | null; summary: string | null; body_markdown: string; moderation: TextState | null } {
  const hidden = state?.state === "hidden" || state?.state === "removed"
  return {
    title: hidden ? null : row.title,
    summary: hidden ? null : row.summary,
    body_markdown: hidden ? "" : row.body_markdown,
    moderation: state ?? null,
  }
}

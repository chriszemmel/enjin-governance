/**
 * Comments are threaded, scoped to a proposal, and soft-deletable so
 * deleting a parent never orphans replies. The row stays with a
 * placeholder body - the UI replaces it with "[comment deleted]"
 * whenever `is_deleted` is true.
 */

import "server-only"
import { getSql } from "./client"

export type CommentRow = {
  id: string
  proposal_id: string
  parent_id: string | null
  user_id: string
  author_address: string
  body_markdown: string
  is_deleted: boolean
  edited_at: Date | null
  created_at: Date
}

export type CreateCommentArgs = {
  proposalId: string
  parentId: string | null
  userId: string
  authorAddress: string
  bodyMarkdown: string
}

export async function createComment(a: CreateCommentArgs): Promise<CommentRow> {
  const sql = getSql()
  const rows = (await sql`
    INSERT INTO comments (
      proposal_id, parent_id, user_id, author_address, body_markdown
    ) VALUES (
      ${a.proposalId}, ${a.parentId}, ${a.userId}, ${a.authorAddress}, ${a.bodyMarkdown}
    )
    RETURNING *
  `) as CommentRow[]
  return rows[0]
}

export async function listCommentsForProposal(
  proposalId: string,
): Promise<CommentRow[]> {
  const sql = getSql()
  return (await sql`
    SELECT * FROM comments
    WHERE proposal_id = ${proposalId}
    ORDER BY created_at ASC
  `) as CommentRow[]
}

export type CommentWithAuthor = CommentRow & {
  author_handle: string | null
  author_display_name: string | null
  author_avatar_url: string | null
  author_is_verified: boolean
}

/**
 * Comments joined with their author's display fields. Hides body
 * content for soft-deleted rows so a deleted comment still occupies a
 * slot (preserving any reply threading) but doesn't leak the original
 * text.
 */
export async function listCommentsForProposalWithAuthors(
  proposalId: string,
): Promise<CommentWithAuthor[]> {
  const sql = getSql()
  return (await sql`
    SELECT c.*,
           u.handle        AS author_handle,
           u.display_name  AS author_display_name,
           u.avatar_url    AS author_avatar_url,
           COALESCE(u.is_verified, FALSE) AS author_is_verified
      FROM comments c
      JOIN users u ON u.id = c.user_id
     WHERE c.proposal_id = ${proposalId}
     ORDER BY c.created_at ASC
  `) as CommentWithAuthor[]
}

export async function getCommentById(id: string): Promise<CommentRow | null> {
  const rows = (await getSql()`
    SELECT * FROM comments WHERE id = ${id} LIMIT 1
  `) as CommentRow[]
  return rows[0] ?? null
}

export async function findCommentOwnership(
  commentId: string,
): Promise<{ userId: string } | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT user_id FROM comments WHERE id = ${commentId} LIMIT 1
  `) as { user_id: string }[]
  if (rows.length === 0) return null
  return { userId: rows[0]!.user_id }
}

/** How long after posting the author may still edit a comment. */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60_000

/** The moment a comment stops being editable. */
export function commentEditableUntil(createdAt: Date): Date {
  return new Date(createdAt.getTime() + COMMENT_EDIT_WINDOW_MS)
}

/**
 * Replace the author's own text. The route checks everything first; the
 * WHERE repeats the rules that could change in between (a delete, the
 * window running out), so null means nothing was written.
 */
export async function editComment(
  id: string,
  userId: string,
  body: string,
): Promise<CommentRow | null> {
  const sql = getSql()
  const postedAfter = new Date(Date.now() - COMMENT_EDIT_WINDOW_MS)
  const rows = (await sql`
    UPDATE comments
       SET body_markdown = ${body}, edited_at = NOW()
     WHERE id = ${id} AND user_id = ${userId} AND is_deleted = FALSE
       AND created_at > ${postedAfter}
     RETURNING *
  `) as CommentRow[]
  return rows[0] ?? null
}

// Stored as the body for soft-deleted rows. Has to be non-empty to
// satisfy the comments_body_len CHECK constraint (length >= 1) - the
// UI never renders it because CommentItem branches on `is_deleted`.
const DELETED_BODY_PLACEHOLDER = "[deleted]"

export async function softDeleteComment(
  id: string,
  userId: string,
): Promise<boolean> {
  const sql = getSql()
  const rows = (await sql`
    UPDATE comments
       SET is_deleted = TRUE,
           body_markdown = ${DELETED_BODY_PLACEHOLDER},
           edited_at = NOW()
     WHERE id = ${id} AND user_id = ${userId}
     RETURNING id
  `) as { id: string }[]
  return rows.length > 0
}

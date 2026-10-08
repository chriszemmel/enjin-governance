import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { isDbConfigured } from "@/lib/db/client"
import {
  COMMENT_EDIT_WINDOW_MS,
  commentEditableUntil,
  editComment,
  findCommentOwnership,
  getCommentById,
  softDeleteComment,
} from "@/lib/db/comments"
import { isMissingTable } from "@/lib/db/errors"
import { getState } from "@/lib/db/moderation"
import { flagText } from "@/lib/moderation/auto-flag"
import { postingSuspendedResponse } from "@/lib/moderation/suspension"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export const runtime = "nodejs"

const uuidSchema = z.string().uuid()
// Same limits as posting (POST /api/proposals/[uuid]/comments).
const patchSchema = z.object({
  body_markdown: z.string().min(1).max(10_000),
})

/**
 * Edit your own comment: only within 15 minutes of posting, not once it
 * was deleted or hidden by moderators, and not while your posting is
 * paused. The new text replaces the old one (no history is kept),
 * `edited_at` is set so the thread shows "edited", and the automatic text
 * check runs again on the new text.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }
  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to edit." },
      { status: 401 },
    )
  }

  const suspended = await postingSuspendedResponse(me)
  if (suspended) return suspended

  const rl = await enforceRateLimit({ ...RATE_LIMITS.commentEdit, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many edits - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  const { id } = await context.params
  const parsedId = uuidSchema.safeParse(id)
  if (!parsedId.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid comment id" },
      { status: 400 },
    )
  }

  let parsed
  try {
    parsed = patchSchema.parse(await request.json())
  } catch {
    return NextResponse.json(
      { ok: false, error: "A comment needs 1 to 10,000 characters of text." },
      { status: 400 },
    )
  }

  const comment = await getCommentById(parsedId.data)
  if (!comment) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 })
  }
  if (comment.user_id !== me.id) {
    return NextResponse.json(
      { ok: false, error: "Not your comment" },
      { status: 403 },
    )
  }
  if (comment.is_deleted) {
    return NextResponse.json(
      { ok: false, error: "This comment was deleted." },
      { status: 409 },
    )
  }
  const editableUntil = commentEditableUntil(new Date(comment.created_at))
  if (Date.now() >= editableUntil.getTime()) {
    return NextResponse.json(
      {
        ok: false,
        error: `Comments can only be edited for ${COMMENT_EDIT_WINDOW_MS / 60_000} minutes after posting.`,
      },
      { status: 403 },
    )
  }

  // Hidden (or removed) by moderators: the author can't swap the text
  // under the decision. If the state can't be read, don't edit.
  let state: Awaited<ReturnType<typeof getState>>
  try {
    state = await getState("comment", comment.id)
  } catch (err) {
    if (!isMissingTable(err)) {
      return NextResponse.json(
        { ok: false, error: "Editing is unavailable right now - try again in a moment." },
        { status: 503 },
      )
    }
    state = null // migration 011 not applied yet: nothing is moderated
  }
  if (state?.state === "hidden" || state?.state === "removed") {
    return NextResponse.json(
      { ok: false, error: "Moderators hid this comment, so it can't be edited." },
      { status: 403 },
    )
  }

  let row = comment
  if (parsed.body_markdown !== comment.body_markdown) {
    const edited = await editComment(comment.id, me.id, parsed.body_markdown)
    if (!edited) {
      // Deleted or out of time since the checks above.
      return NextResponse.json(
        { ok: false, error: "This comment can no longer be edited." },
        { status: 409 },
      )
    }
    row = edited
    flagText({
      targetType: "comment",
      targetId: row.id,
      proposalId: row.proposal_id,
      text: parsed.body_markdown,
    })
  }

  return NextResponse.json({
    ok: true,
    comment: {
      id: row.id,
      proposal_id: row.proposal_id,
      parent_id: row.parent_id,
      user_id: row.user_id,
      author_address: row.author_address,
      author_handle: me.handle,
      author_display_name: me.display_name,
      author_avatar_url: me.avatar_url,
      author_is_verified:
        (me as unknown as { is_verified?: boolean }).is_verified ?? false,
      body_markdown: row.body_markdown,
      is_deleted: row.is_deleted,
      moderation:
        state && state.state !== "visible" ? { state: state.state, reason: state.reason } : null,
      edited_at: row.edited_at,
      editable_until: editableUntil,
      created_at: row.created_at,
    },
  })
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }
  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "Sign in to delete." },
      { status: 401 },
    )
  }
  const rl = await enforceRateLimit({ ...RATE_LIMITS.commentDelete, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }
  const { id } = await context.params
  const parsed = uuidSchema.safeParse(id)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid comment id" },
      { status: 400 },
    )
  }
  try {
    const own = await findCommentOwnership(parsed.data)
    if (!own) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 })
    }
    if (own.userId !== me.id) {
      return NextResponse.json(
        { ok: false, error: "Not your comment" },
        { status: 403 },
      )
    }
    const removed = await softDeleteComment(parsed.data, me.id)
    return NextResponse.json({ ok: removed })
  } catch (e) {
    console.error("DELETE /api/comments/[id] failed", e instanceof Error ? e.message : String(e))
    return NextResponse.json(
      { ok: false, error: "The comment could not be deleted - try again." },
      { status: 500 },
    )
  }
}

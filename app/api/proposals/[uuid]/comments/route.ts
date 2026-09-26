import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { isDbConfigured } from "@/lib/db/client"
import {
  createComment,
  listCommentsForProposalWithAuthors,
} from "@/lib/db/comments"
import { getProposalById } from "@/lib/db/proposals"
import { listStatesForProposal } from "@/lib/db/moderation"
import { postingSuspendedResponse } from "@/lib/moderation/suspension"
import { flagText } from "@/lib/moderation/auto-flag"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { isMissingTable } from "@/lib/db/errors"

export const runtime = "nodejs"

const uuidSchema = z.string().uuid()
const postSchema = z.object({
  body_markdown: z.string().min(1).max(10_000),
  parent_id: z.string().uuid().nullable().optional(),
})

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ uuid: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }
  const { uuid: raw } = await context.params
  const parsed = uuidSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid proposal uuid" },
      { status: 400 },
    )
  }
  const rows = await listCommentsForProposalWithAuthors(parsed.data)
  // Moderated comments: hidden ones lose their text here, on the server;
  // blurred ones keep it behind a tap in the UI. If the states can't be
  // read, nothing is shown rather than something hidden.
  let stateRows: Awaited<ReturnType<typeof listStatesForProposal>>
  try {
    stateRows = await listStatesForProposal(parsed.data)
  } catch (err) {
    if (!isMissingTable(err)) {
      return NextResponse.json(
        { ok: false, error: "Comments are unavailable right now - try again." },
        { status: 503 },
      )
    }
    stateRows = [] // migration 011 not applied yet: nothing is moderated
  }
  const states = new Map(
    stateRows.filter((s) => s.target_type === "comment").map((s) => [s.target_id, s]),
  )
  return NextResponse.json({
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      proposal_id: r.proposal_id,
      parent_id: r.parent_id,
      user_id: r.user_id,
      author_address: r.author_address,
      author_handle: r.author_handle,
      author_display_name: r.author_display_name,
      author_avatar_url: r.author_avatar_url,
      author_is_verified: r.author_is_verified,
      body_markdown:
        r.is_deleted || ["hidden", "removed"].includes(states.get(r.id)?.state ?? "")
          ? ""
          : r.body_markdown,
      is_deleted: r.is_deleted,
      moderation: states.get(r.id)
        ? { state: states.get(r.id)!.state, reason: states.get(r.id)!.reason }
        : null,
      edited_at: r.edited_at,
      created_at: r.created_at,
    })),
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ uuid: string }> },
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
      { ok: false, error: "Sign in to comment." },
      { status: 401 },
    )
  }

  const suspended = await postingSuspendedResponse(me)
  if (suspended) return suspended

  const rl = await enforceRateLimit({ ...RATE_LIMITS.commentCreate, identity: me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many comments - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  const { uuid: raw } = await context.params
  const uid = uuidSchema.safeParse(raw)
  if (!uid.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid proposal uuid" },
      { status: 400 },
    )
  }
  const proposal = await getProposalById(uid.data)
  if (!proposal) {
    return NextResponse.json(
      { ok: false, error: "Proposal not found" },
      { status: 404 },
    )
  }

  let parsed
  try {
    parsed = postSchema.parse(await request.json())
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    )
  }

  const row = await createComment({
    proposalId: proposal.id,
    parentId: parsed.parent_id ?? null,
    userId: me.id,
    authorAddress: me.address,
    bodyMarkdown: parsed.body_markdown,
  })
  flagText({
    targetType: "comment",
    targetId: row.id,
    proposalId: proposal.id,
    text: parsed.body_markdown,
  })

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
      edited_at: row.edited_at,
      created_at: row.created_at,
    },
  })
}

/**
 * POST /api/moderation/actions
 *
 * A moderator decision on a reported item, or an admin pausing someone's
 * posting. Every action needs a reason and lands in the public log.
 *
 *   keep / blur / hide / restore   moderators (blur: attachments only)
 *   delete_file                    admins, attachments only - removes the
 *                                  file and its thumbnail from storage
 *   suspend / unsuspend            admins, pauses comments, drafts, uploads
 *
 * proposal.json is never touched, so a proposal's EGOV1 verification
 * stays intact whatever happens to its images.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth/roles"
import { getUserByAddress } from "@/lib/db/users"
import { closeReports, insertAction, setPostingSuspended, setState } from "@/lib/db/moderation"
import { thumbKeyFor } from "@/lib/governance/proposal-media"
import {
  allowedActions,
  reportStatusAfter,
  stateAfter,
  type ContentAction,
} from "@/lib/moderation/policy"
import { resolveTarget } from "@/lib/moderation/targets"
import { deleteObjects } from "@/lib/r2/upload"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export const runtime = "nodejs"

const reason = z.string().trim().min(3).max(500)

const bodySchema = z.discriminatedUnion("target_type", [
  z
    .object({
      target_type: z.enum(["proposal", "attachment", "comment"]),
      target_id: z.string().min(1).max(300),
      action: z.enum(["keep", "blur", "hide", "restore", "delete_file"]),
      reason,
    })
    .strict(),
  z
    .object({
      target_type: z.literal("user"),
      target_id: z.string().min(1).max(64),
      action: z.enum(["suspend", "unsuspend"]),
      days: z.number().int().min(1).max(365).optional(),
      reason,
    })
    .strict(),
])

export async function POST(request: NextRequest): Promise<NextResponse> {
  const mod = await requireRole("moderator")
  if (mod instanceof NextResponse) return mod

  const rl = await enforceRateLimit({ ...RATE_LIMITS.moderationAction, identity: mod.me.id })
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many actions - please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    )
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json(
      { ok: false, error: "Pick an action and give a reason (3-500 characters)." },
      { status: 400 },
    )
  }

  if (parsed.target_type === "user") {
    if (mod.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 })
    }
    const user = await getUserByAddress(parsed.target_id)
    if (!user) return NextResponse.json({ ok: false, error: "Unknown account." }, { status: 404 })
    const until =
      parsed.action === "suspend"
        ? new Date(Date.now() + (parsed.days ?? 7) * 24 * 60 * 60 * 1000)
        : null
    await setPostingSuspended(user.id, until)
    await insertAction({
      targetType: "user",
      targetId: user.address,
      proposalId: null,
      network: user.network,
      referendumIndex: null,
      action: parsed.action,
      reason: parsed.reason,
      source: "moderator",
      actorPublicKey: mod.publicKey,
      actorLabel: mod.label,
    })
    return NextResponse.json({ ok: true, suspended_until: until })
  }

  const action = parsed.action as ContentAction
  if (!allowedActions(parsed.target_type, mod.role).includes(action)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          action === "delete_file"
            ? "Only admins can delete files."
            : `"${action}" doesn't apply to a ${parsed.target_type}.`,
      },
      { status: 403 },
    )
  }

  const target = await resolveTarget(parsed.target_type, parsed.target_id)
  if (!target) {
    return NextResponse.json({ ok: false, error: "That item doesn't exist." }, { status: 404 })
  }

  if (action === "delete_file") {
    try {
      await deleteObjects([target.id, thumbKeyFor(target.id)])
    } catch {
      return NextResponse.json(
        { ok: false, error: "Storage error - the file was not deleted." },
        { status: 502 },
      )
    }
  }

  await setState({
    targetType: target.type,
    targetId: target.id,
    proposalId: target.proposal.id,
    state: stateAfter(action),
    reason: parsed.reason,
    source: "moderator",
  })
  await closeReports(target.type, target.id, reportStatusAfter(action))
  await insertAction({
    targetType: target.type,
    targetId: target.id,
    proposalId: target.proposal.id,
    network: target.proposal.network,
    referendumIndex: target.proposal.referendum_index,
    action,
    reason: parsed.reason,
    source: "moderator",
    actorPublicKey: mod.publicKey,
    actorLabel: mod.label,
  })
  return NextResponse.json({ ok: true, state: stateAfter(action) })
}

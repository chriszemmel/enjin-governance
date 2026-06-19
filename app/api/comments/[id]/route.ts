import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import { isDbConfigured } from "@/lib/db/client"
import { findCommentOwnership, softDeleteComment } from "@/lib/db/comments"

export const runtime = "nodejs"

const uuidSchema = z.string().uuid()

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
    const message = e instanceof Error ? e.message : "Unknown error"
    console.error("DELETE /api/comments/[id] failed", e)
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    )
  }
}

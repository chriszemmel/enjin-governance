"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  Check,
  CheckCircle2,
  Flag,
  Loader2,
  MessageCircle,
  Pencil,
  Send,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Avatar } from "@/components/account/avatar"
import { UserChip } from "@/components/profile/user-chip"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { ReportDialog } from "@/components/moderation/report-dialog"
import {
  type Comment,
  useComments,
  useCreateComment,
  useDeleteComment,
  useEditComment,
} from "@/lib/query/hooks/use-comments"
import { useMe, useNoncePrefetch, useSignIn } from "@/lib/query/hooks/use-session"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { buildSignRequestDeepLink } from "@/lib/wallet/deep-link"
import { formatError } from "@/lib/utils/format-error"

type Props = {
  proposalUuid: string | null
}

export function CommentsSection({ proposalUuid }: Props) {
  const listQuery = useComments(proposalUuid)
  const meQuery = useMe()
  const me = meQuery.data ?? null
  const { status: walletStatus, session: walletSession, connectorId } = useWallet()
  const isWalletConnected = walletStatus === "connected"
  const isWalletConnect =
    connectorId === "enjin-wallet" || connectorId === "walletconnect"
  const prefetchedNonce = useNoncePrefetch()
  const signIn = useSignIn(prefetchedNonce)
  const create = useCreateComment(proposalUuid)
  const remove = useDeleteComment(proposalUuid)
  const edit = useEditComment(proposalUuid)
  const [draft, setDraft] = useState("")
  const [reporting, setReporting] = useState<string | null>(null)
  const [signModalOpen, setSignModalOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const signDeepLinkUrl = buildSignRequestDeepLink({
    peerRedirect:
      (walletSession?.meta?.peerRedirect as string | null | undefined) ?? null,
    sessionTopic:
      (walletSession?.meta?.topic as string | undefined) ?? null,
  })
  const walletMeta = walletDisplayFor(walletSession ?? null)

  if (!proposalUuid) {
    return (
      <div className="rounded-2xl bg-card border border-border p-6 text-sm text-muted-foreground">
        Comments will appear here once this referendum has off-chain metadata.
      </div>
    )
  }

  const onSubmit = async () => {
    const text = draft.trim()
    if (!text) return
    try {
      await create.mutateAsync({ body_markdown: text })
      setDraft("")
    } catch (e) {
      toast.error("Could not post comment", {
        description: formatError(e),
      })
    }
  }

  const onSignIn = async () => {
    setSignError(null)
    if (isWalletConnect) setSignModalOpen(true)
    try {
      await signIn.submit()
      setSignModalOpen(false)
      toast.success("Signed in")
    } catch (e) {
      const message = formatError(e)
      setSignError(message)
    }
  }

  const onRetrySignIn = () => {
    setSignError(null)
    signIn
      .submit()
      .then(() => {
        setSignModalOpen(false)
        toast.success("Signed in")
      })
      .catch((e) => {
        setSignError(formatError(e))
      })
  }

  return (
    <div className="rounded-2xl bg-card border border-border p-6 space-y-5">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground">
          Comments
          {listQuery.data && (
            <span className="text-xs text-muted-foreground font-normal ml-2">
              {listQuery.data.length}
            </span>
          )}
        </h2>
      </div>

      <div className="space-y-3">
        {listQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !listQuery.data || listQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No comments yet. Be the first.
          </p>
        ) : (
          <ul className="space-y-3">
            {listQuery.data.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                isMine={me?.id === c.user_id}
                onReport={() => setReporting(c.id)}
                onEdit={async (body) => {
                  await edit.mutateAsync({ id: c.id, body_markdown: body })
                }}
                onDelete={async () => {
                  try {
                    await remove.mutateAsync(c.id)
                  } catch (e) {
                    toast.error("Could not delete", {
                      description: formatError(e),
                    })
                  }
                }}
              />
            ))}
          </ul>
        )}
        <ReportDialog
          target={reporting ? { type: "comment", id: reporting } : null}
          onClose={() => setReporting(null)}
        />
      </div>

      <div className="pt-3 border-t border-border">
        {me ? (
          <div className="flex items-start gap-3">
            <Avatar
              url={me.avatar_url}
              address={me.address}
              fallback={me.display_name ?? me.handle ?? me.address}
              size="md"
            />
            <div className="flex-1 space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Share your thoughts on this proposal…"
                rows={3}
                maxLength={10_000}
                className="w-full px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-y"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                  Signed in as
                  <UserChip address={me.address} size="xs" hideAvatar />
                </span>
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={create.isPending || !draft.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {create.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Post
                </button>
              </div>
            </div>
          </div>
        ) : isWalletConnected ? (
          <div className="rounded-xl bg-surface-1 border border-border p-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              Sign in with your wallet to comment. Signs a one-line nonce,
              no transaction or fee.
            </p>
            <button
              type="button"
              onClick={onSignIn}
              disabled={signIn.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors disabled:opacity-50"
            >
              {signIn.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : null}
              Sign in
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setWalletOpen(true)}
              className="font-medium text-primary hover:text-purple-dim"
            >
              Connect a wallet
            </button>{" "}
            to comment.
          </p>
        )}
      </div>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <SignRequestModal
        open={signModalOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the sign request in your wallet"
        status={signError ? { kind: "error", message: signError } : { kind: "signing" }}
        deepLinkUrl={signDeepLinkUrl}
        onClose={() => setSignModalOpen(false)}
        onRetry={onRetrySignIn}
      />
    </div>
  )
}

function CommentItem({
  comment,
  isMine,
  onDelete,
  onEdit,
  onReport,
}: {
  comment: Comment
  isMine: boolean
  onDelete: () => Promise<void>
  onEdit: (body: string) => Promise<void>
  onReport: () => void
}) {
  const [shown, setShown] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState("")
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const mod = comment.moderation
  const withheld = mod?.state === "hidden" || mod?.state === "removed"
  const inEditWindow = useBefore(comment.editable_until)
  // The server has the final say (window, pauses, moderation); this only
  // decides whether to offer the action.
  const canEdit = isMine && !comment.is_deleted && !withheld && inEditWindow
  const showEditor = editing && !comment.is_deleted && !withheld

  const startEdit = () => {
    setText(comment.body_markdown)
    setEditError(null)
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    setEditError(null)
  }
  const saveEdit = async () => {
    const body = text.trim()
    if (!body) return
    setSaving(true)
    setEditError(null)
    try {
      await onEdit(body)
      setEditing(false)
    } catch (e) {
      setEditError(formatError(e))
    } finally {
      setSaving(false)
    }
  }
  const fallbackName =
    comment.author_display_name ??
    (comment.author_handle ? `@${comment.author_handle}` : null) ??
    comment.author_address
  return (
    <li className="flex items-start gap-3">
      <Avatar
        url={comment.author_avatar_url}
        address={comment.author_address}
        fallback={fallbackName}
        size="md"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <UserChip address={comment.author_address} size="sm" hideAvatar />
          {comment.author_is_verified && (
            <CheckCircle2
              className="w-3 h-3 text-primary"
              aria-label="Verified"
            />
          )}
          <span className="text-muted-foreground">
            {relativeTime(comment.created_at)}
          </span>
          {comment.edited_at && !comment.is_deleted && (
            <span
              className="text-muted-foreground"
              title={`Edited ${new Date(comment.edited_at).toLocaleString()}`}
            >
              · edited
            </span>
          )}
        </div>
        {showEditor ? (
          <div className="mt-1 space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !saving) cancelEdit()
              }}
              aria-label="Edit your comment"
              rows={3}
              maxLength={10_000}
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-y"
            />
            {editError && (
              <p role="alert" className="text-xs text-destructive">
                {editError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={
                  saving || !text.trim() || text.trim() === comment.body_markdown
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1 text-sm text-foreground/90 whitespace-pre-wrap break-words">
            {comment.is_deleted ? (
              <span className="italic text-muted-foreground">
                [comment deleted]
              </span>
            ) : withheld ? (
              <span className="italic text-muted-foreground">
                [hidden by moderators{mod?.reason ? `: ${mod.reason}` : ""}] ·{" "}
                <Link href="/moderation-log" className="not-italic text-primary hover:text-purple-dim">
                  log
                </Link>
              </span>
            ) : mod?.state === "blurred" && !shown ? (
              <button
                type="button"
                onClick={() => setShown(true)}
                className="italic text-muted-foreground hover:text-foreground"
              >
                [marked sensitive by moderators · show]
              </button>
            ) : (
              comment.body_markdown
            )}
          </div>
        )}
        <div className="mt-1 flex items-center gap-3">
          {canEdit && !showEditor && (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              title="Edit (for 15 minutes after posting)"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          )}
          {isMine && !comment.is_deleted && !showEditor && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive"
              title="Delete (soft)"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          )}
          {!isMine && !comment.is_deleted && !withheld && (
            <button
              type="button"
              onClick={onReport}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Flag className="w-3 h-3" />
              Report
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** True until `iso` passes; re-renders the moment it does. */
function useBefore(iso: string | undefined): boolean {
  const deadline = iso ? new Date(iso).getTime() : 0
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const left = deadline - Date.now()
    if (left <= 0) return
    const timer = setTimeout(() => setNow(Date.now()), left + 50)
    return () => clearTimeout(timer)
  }, [deadline])
  return now < deadline
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

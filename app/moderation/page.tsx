"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Bot, Eye, FileText, Loader2, ShieldCheck, Trash2, UserX } from "lucide-react"
import { toast } from "sonner"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { useActiveChain } from "@/lib/chain/use-chain"
import { encodePublicKeyForChain, shortenAddress } from "@/lib/chain/ss58"
import {
  allowedActions,
  REPORT_CATEGORY_LABELS,
  type ContentAction,
  type ReportCategory,
} from "@/lib/moderation/policy"
import {
  useModerationAction,
  useModerationQueue,
  useModerationRoles,
  useMyModerationRole,
  useSetRole,
  type QueueItem,
} from "@/lib/query/hooks/use-moderation"
import { useMe } from "@/lib/query/hooks/use-session"
import { cn } from "@/lib/utils"
import { formatError } from "@/lib/utils/format-error"

const ACTION_LABELS: Record<ContentAction, string> = {
  keep: "Keep visible",
  blur: "Blur",
  hide: "Hide",
  restore: "Restore",
  delete_file: "Delete file",
}

const SEVERITY_TONE = {
  high: "bg-red-500/10 text-red-600 dark:text-red-400",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  low: "bg-surface-2 text-muted-foreground",
}

function itemTitle(i: QueueItem): string {
  if (i.target_type === "attachment") return i.attachment_name ?? "Attachment"
  if (i.target_type === "comment") return "Comment"
  return i.proposal_title ?? "Proposal text"
}

function itemWhere(i: QueueItem): string {
  const where = i.referendum_index != null ? `referendum #${i.referendum_index}` : "a draft"
  const kind =
    i.target_type === "attachment"
      ? "Attachment"
      : i.target_type === "comment"
        ? "Comment"
        : "Proposal"
  return `${kind} on ${where}`
}

function flaggedBy(i: QueueItem): string {
  const parts: string[] = []
  if (i.automatic) parts.push("Automatic check")
  if (i.user_reports > 0)
    parts.push(`${i.user_reports} user report${i.user_reports === 1 ? "" : "s"}`)
  return parts.join(" + ")
}

export default function ModerationPage() {
  const me = useMe()
  const roleQuery = useMyModerationRole(!!me.data)
  const role = roleQuery.data ?? null
  const queue = useModerationQueue(role != null)
  const [tab, setTab] = useState<"queue" | "roles">("queue")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const items = useMemo(() => queue.data?.items ?? [], [queue.data])
  const selected =
    items.find((i) => `${i.target_type}:${i.target_id}` === selectedKey) ?? items[0] ?? null

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-foreground">Moderation</h1>
              {role && (
                <span className="inline-flex items-center gap-1 rounded-full border border-purple-border bg-primary/5 px-2.5 py-0.5 text-xs text-primary">
                  <ShieldCheck className="w-3 h-3" />
                  {role === "admin" ? "Admin" : "Moderator"}
                </span>
              )}
            </div>
            {role && (
              <div className="inline-flex rounded-lg border border-border bg-surface-1 p-0.5 text-sm">
                <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
                  Queue · {queue.data?.stats.open ?? 0}
                </TabButton>
                <Link
                  href="/moderation-log"
                  className="px-3 py-1 rounded-md text-muted-foreground hover:text-foreground"
                >
                  Public log
                </Link>
                {role === "admin" && (
                  <TabButton active={tab === "roles"} onClick={() => setTab("roles")}>
                    Roles
                  </TabButton>
                )}
              </div>
            )}
          </div>

          {me.isPending || (me.data && roleQuery.isPending) ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !me.data ? (
            <Notice>
              Sign in with a moderator wallet on your{" "}
              <Link href="/account?next=/moderation" className="text-primary">
                account page
              </Link>
              .
            </Notice>
          ) : !role ? (
            <Notice>
              This account isn&apos;t a moderator. The{" "}
              <Link href="/moderation-log" className="text-primary">
                public moderation log
              </Link>{" "}
              lists every decision.
            </Notice>
          ) : tab === "roles" ? (
            <RolesPanel />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-4">
              <div className="rounded-2xl bg-card border border-border overflow-hidden">
                {queue.isPending ? (
                  <p className="p-5 text-sm text-muted-foreground">Loading the queue…</p>
                ) : queue.isError ? (
                  <p className="p-5 text-sm text-destructive">{formatError(queue.error)}</p>
                ) : items.length === 0 ? (
                  <p className="p-5 text-sm text-muted-foreground">Nothing to review. 🎉</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {items.map((i) => {
                      const key = `${i.target_type}:${i.target_id}`
                      const active =
                        selected && key === `${selected.target_type}:${selected.target_id}`
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            onClick={() => setSelectedKey(key)}
                            className={cn(
                              "w-full grid grid-cols-[2.75rem_1fr_auto] items-center gap-3 px-4 py-3 text-left transition-colors",
                              active
                                ? "bg-primary/5 shadow-[inset_3px_0_0] shadow-primary"
                                : "hover:bg-surface-1",
                            )}
                          >
                            <span className="w-11 h-11 rounded-lg bg-surface-2 flex items-center justify-center text-[9px] font-semibold uppercase text-muted-foreground">
                              {i.target_type === "attachment" ? (
                                <FileText className="w-4 h-4" />
                              ) : i.target_type === "comment" ? (
                                "Comm."
                              ) : (
                                "Text"
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {itemTitle(i)}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {itemWhere(i)} · {flaggedBy(i)}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "rounded-md px-2 py-0.5 text-[11px] font-medium capitalize",
                                SEVERITY_TONE[i.severity],
                              )}
                            >
                              {i.severity}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {queue.data && (
                  <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                    Open reports: {queue.data.stats.open} · Auto-blurred today:{" "}
                    {queue.data.stats.auto_blurred_today}
                  </p>
                )}
              </div>
              {selected && (
                <DetailPanel
                  key={`${selected.target_type}:${selected.target_id}`}
                  item={selected}
                  role={role}
                />
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}

function DetailPanel({ item, role }: { item: QueueItem; role: "moderator" | "admin" }) {
  const act = useModerationAction()
  const actions = allowedActions(item.target_type, role)
  const [action, setAction] = useState<ContentAction | null>(null)
  const [reason, setReason] = useState("")
  const [showImage, setShowImage] = useState(false)
  const [suspendDays, setSuspendDays] = useState(7)
  const auto = item.details[0]
  const author = item.target_type === "comment" ? item.comment_author : item.proposer_address

  useEffect(() => {
    // Pre-fill the reason from the automatic check, still editable.
    if (auto?.explanation) setReason(auto.explanation)
  }, [auto?.explanation])

  const apply = () => {
    if (!action) return
    act.mutate(
      { target_type: item.target_type, target_id: item.target_id, action, reason: reason.trim() },
      {
        onSuccess: () => toast.success(`${ACTION_LABELS[action]} - logged publicly`),
        onError: (e) => toast.error("Could not apply", { description: formatError(e) }),
      },
    )
  }

  const suspend = () => {
    if (!author) return
    act.mutate(
      {
        target_type: "user",
        target_id: author,
        action: "suspend",
        days: suspendDays,
        reason: reason.trim(),
      },
      {
        onSuccess: () => toast.success(`Posting paused for ${suspendDays} days`),
        onError: (e) => toast.error("Could not pause posting", { description: formatError(e) }),
      },
    )
  }

  const proposalHref =
    item.referendum_index != null
      ? `/proposals/${item.referendum_index}?network=${item.network}`
      : null

  return (
    <div className="rounded-2xl bg-card border border-border p-5 space-y-4 self-start">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground break-all">{itemTitle(item)}</h2>
        {item.state && item.state !== "visible" && (
          <span className="flex-shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-600 dark:text-amber-400 capitalize">
            {item.state}
          </span>
        )}
      </div>

      {item.target_type === "attachment" && item.attachment_type?.startsWith("image/") && (
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-1">
          <img
            src={`/api/moderation/media?key=${encodeURIComponent(item.target_id)}`}
            alt=""
            className={cn("w-full max-h-72 object-contain", !showImage && "blur-2xl scale-110")}
          />
          {!showImage && (
            <button
              type="button"
              onClick={() => setShowImage(true)}
              className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium"
            >
              <Eye className="w-3.5 h-3.5" />
              Show image
            </button>
          )}
        </div>
      )}
      {item.target_type === "attachment" && !item.attachment_type?.startsWith("image/") && (
        <a
          href={`/api/moderation/media?key=${encodeURIComponent(item.target_id)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary"
        >
          <FileText className="w-4 h-4" />
          Open the file
        </a>
      )}
      {item.target_type === "comment" && (
        <blockquote className="rounded-xl border border-border bg-surface-1 p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
          {item.comment_body}
        </blockquote>
      )}
      {proposalHref && (
        <Link href={proposalHref} className="inline-flex items-center gap-1 text-xs text-primary">
          Open referendum #{item.referendum_index} <ArrowRight className="w-3 h-3" />
        </Link>
      )}

      {auto && (
        <div className="rounded-xl border border-border bg-surface-1 p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            <Bot className="w-3.5 h-3.5" />
            Automatic check
          </p>
          <div className="flex flex-wrap gap-1.5">
            {auto.decision && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-600 dark:text-red-400">
                {auto.decision}
              </span>
            )}
            {(auto.labels ?? []).map((l) => (
              <span
                key={l}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {l.replace(/_/g, " ")}
              </span>
            ))}
          </div>
          {auto.explanation && (
            <p className="text-sm text-foreground">&ldquo;{auto.explanation}&rdquo;</p>
          )}
        </div>
      )}

      {item.user_reports > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Reports ({item.user_reports})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {item.categories.map((c) => (
              <span
                key={c}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {REPORT_CATEGORY_LABELS[c as ReportCategory] ?? c}
              </span>
            ))}
          </div>
          {item.notes.map((n, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              &ldquo;{n}&rdquo;
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAction(a)}
            className={cn(
              "rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
              a === "delete_file" && "col-span-2 sm:col-span-4",
              action === a
                ? a === "delete_file"
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-purple-border bg-primary/10 text-primary"
                : a === "delete_file"
                  ? "border-destructive/40 text-destructive hover:bg-destructive/5"
                  : "border-border text-foreground hover:bg-surface-1",
            )}
          >
            {a === "delete_file" ? (
              <span className="inline-flex items-center gap-1">
                <Trash2 className="w-3 h-3" />
                Delete the file (admins, for legal takedowns)
              </span>
            ) : (
              ACTION_LABELS[a]
            )}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Reason (public)"
          className="w-full rounded-xl border border-border bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
        />
        <p className="text-[11px] text-muted-foreground">
          Required. Shown in the public moderation log.
        </p>
      </div>

      <button
        type="button"
        onClick={apply}
        disabled={!action || reason.trim().length < 3 || act.isPending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-purple-dim disabled:opacity-50"
      >
        {act.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        {action ? `Apply · ${ACTION_LABELS[action]}` : "Pick an action"}
      </button>

      {role === "admin" && author && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <UserX className="w-3.5 h-3.5" />
          Pause posting for {shortenAddress(author)} for
          <select
            value={suspendDays}
            onChange={(e) => setSuspendDays(Number(e.target.value))}
            className="rounded-md border border-border bg-surface-1 px-1.5 py-0.5"
          >
            {[1, 7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {d} day{d === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={suspend}
            disabled={reason.trim().length < 3 || act.isPending}
            className="rounded-md border border-destructive/40 px-2 py-0.5 text-destructive disabled:opacity-50"
          >
            Pause
          </button>
        </div>
      )}
    </div>
  )
}

function RolesPanel() {
  const chain = useActiveChain()
  const roles = useModerationRoles(true)
  const setRole = useSetRole()
  const [address, setAddress] = useState("")
  const [role, setRoleValue] = useState<"moderator" | "admin">("moderator")

  const display = (key: string) => {
    try {
      return encodePublicKeyForChain(key, chain.id)
    } catch {
      return key
    }
  }

  return (
    <div className="rounded-2xl bg-card border border-border p-5 space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Moderators blur, hide and restore content. Admins can also delete files, pause posting and
        manage roles. Roles follow the wallet on every network.
      </p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {(roles.data ?? []).map((r) => (
          <li key={r.public_key} className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex-1 min-w-0 font-mono text-xs text-foreground truncate">
              {display(r.public_key)}
            </span>
            <span className="text-xs capitalize text-muted-foreground">{r.role}</span>
            {r.fixed ? (
              <span className="text-[11px] text-muted-foreground">server config</span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setRole.mutate(
                    { address: display(r.public_key), role: null },
                    { onError: (e) => toast.error(formatError(e)) },
                  )
                }
                className="text-[11px] text-destructive"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value.trim())}
          placeholder="Wallet address"
          className="flex-1 min-w-[16rem] rounded-xl border border-border bg-surface-1 px-3 py-2 font-mono text-xs focus:outline-none focus:border-primary/50"
        />
        <select
          value={role}
          onChange={(e) => setRoleValue(e.target.value as "moderator" | "admin")}
          className="rounded-xl border border-border bg-surface-1 px-3 py-2 text-sm"
        >
          <option value="moderator">Moderator</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="button"
          disabled={!address || setRole.isPending}
          onClick={() =>
            setRole.mutate(
              { address, role },
              {
                onSuccess: () => {
                  setAddress("")
                  toast.success("Role granted - logged publicly")
                },
                onError: (e) =>
                  toast.error("Could not grant the role", { description: formatError(e) }),
              },
            )
          }
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Grant
        </button>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-md",
        active
          ? "bg-card text-foreground shadow-sm border border-border"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 text-sm text-muted-foreground">
      {children}
    </div>
  )
}

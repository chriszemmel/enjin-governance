"use client"

import Link from "next/link"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { useModerationLog, type LogItem } from "@/lib/query/hooks/use-moderation"
import { cn } from "@/lib/utils"
import { formatError } from "@/lib/utils/format-error"

const ACTION_BADGE: Record<string, { label: string; tone: string }> = {
  keep: { label: "Kept visible", tone: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  restore: { label: "Restored", tone: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  blur: { label: "Blurred", tone: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
  hide: { label: "Hidden", tone: "border-purple-border text-primary" },
  delete_file: { label: "File deleted", tone: "border-red-500/40 text-red-600 dark:text-red-400" },
  suspend: { label: "Posting paused", tone: "border-red-500/40 text-red-600 dark:text-red-400" },
  unsuspend: { label: "Posting resumed", tone: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  grant: { label: "Role granted", tone: "border-border text-muted-foreground" },
  revoke: { label: "Role removed", tone: "border-border text-muted-foreground" },
}

function what(i: LogItem): string {
  const on = i.referendum_index != null ? ` on referendum #${i.referendum_index}` : ""
  switch (i.target_type) {
    case "attachment":
      return `Attachment${on}`
    case "comment":
      return `Comment${on}`
    case "proposal":
      return `Proposal text${on}`
    case "user":
      return "Account"
    default:
      return "Moderator roles"
  }
}

function by(i: LogItem): string {
  if (i.source === "proposer") return "by the proposer"
  if (i.source === "automatic") return "automatic check"
  return i.actor ?? "moderator"
}

export default function ModerationLogPage() {
  const log = useModerationLog()
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-2xl mx-auto space-y-5">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Moderation log</h1>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Every moderation action on this site, with its reason. Referenda, votes and
              on-chain records are never changed.
            </p>
          </div>

          <div className="rounded-2xl bg-card border border-border overflow-hidden">
            {log.isPending ? (
              <p className="p-5 text-sm text-muted-foreground">Loading…</p>
            ) : log.isError ? (
              <p className="p-5 text-sm text-destructive">{formatError(log.error)}</p>
            ) : (log.data ?? []).length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No moderation actions yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {log.data!.map((i) => {
                  const badge = ACTION_BADGE[i.action] ?? { label: i.action, tone: "border-border" }
                  const href =
                    i.referendum_index != null && i.network
                      ? `/proposals/${i.referendum_index}?network=${i.network}`
                      : null
                  return (
                    <li key={i.id} className="p-4 space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px]", badge.tone)}>
                          {badge.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(i.created_at).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-foreground">
                        {href ? (
                          <Link href={href} className="hover:text-primary">
                            {what(i)}
                          </Link>
                        ) : (
                          what(i)
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {i.reason} · {by(i)}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
            Content policy:{" "}
            <Link href="/docs#content-policy" className="text-primary hover:text-purple-dim">
              what isn&apos;t allowed, and how moderation works
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}

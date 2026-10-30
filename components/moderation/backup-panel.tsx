"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, Download, Loader2, ShieldAlert, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Checkbox } from "@/components/ui/checkbox"
import { formatUtc } from "@/lib/moderation/status"
import { cn } from "@/lib/utils"
import { readApiError } from "@/lib/utils/api-error"
import { formatError } from "@/lib/utils/format-error"

type Backup = { key: string; size: number; created: string }

type Running = {
  phase: "database" | "files" | "finishing"
  done: number
  total: number
  bytes: number
  include_media: boolean
  started_at: string
}

type BackupList = { items: Backup[]; running: Running | null; keep: number }

const QUERY_KEY = ["moderation", "backups"]

/** The stored backups and the one running now; polled while one runs. */
function useBackups(creating: boolean) {
  return useQuery<BackupList>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/moderation/backup", { cache: "no-store" })
      if (!res.ok) throw new Error(await readApiError(res))
      return (await res.json()) as BackupList
    },
    refetchInterval: (query) => (creating || query.state.data?.running ? 2_000 : false),
    retry: 1,
  })
}

/** Our routes answer JSON; a platform timeout page is replaced by a sentence. */
async function failure(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "")
  try {
    const error = (JSON.parse(text) as { error?: unknown }).error
    if (typeof error === "string" && error) return new Error(error)
  } catch {
    // Not one of ours.
  }
  return new Error(
    res.status === 504
      ? "The backup took too long and was stopped. Create it without uploaded files, or try again later."
      : "The backup did not finish. Try again later.",
  )
}

function useCreateBackup() {
  return useMutation<{ backup: Backup }, Error, { include_media: boolean }>({
    mutationFn: async (body) => {
      let res: Response
      try {
        res = await fetch("/api/moderation/backup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      } catch {
        throw new Error(
          "The connection to the server was lost. The backup may still finish: it shows up in the list when it does.",
        )
      }
      if (!res.ok) throw await failure(res)
      return (await res.json()) as { backup: Backup }
    },
  })
}

function useDeleteBackup() {
  return useMutation<unknown, Error, string>({
    mutationFn: async (key) => {
      const res = await fetch("/api/moderation/backup", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      return res.json()
    },
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function elapsed(since: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** Where a running backup is, as a share of the whole (null: not known yet). */
function share(r: Running | null): number | null {
  if (!r) return null
  const part = r.total > 0 ? Math.min(r.done / r.total, 1) : 0
  if (r.phase === "database") return Math.round(5 + 20 * part)
  if (r.phase === "files") return Math.round(25 + 70 * part)
  return 97
}

function phaseLabel(r: Running | null): string {
  if (!r) return "Starting…"
  if (r.phase === "database") return `Reading the database · ${r.done} of ${r.total} tables`
  if (r.phase === "files") return `Adding files · ${r.done} of ${r.total}`
  return "Saving the ZIP…"
}

export function BackupPanel() {
  const queryClient = useQueryClient()
  const [includeMedia, setIncludeMedia] = useState(false)
  const create = useCreateBackup()
  const backups = useBackups(create.isPending)
  const running = backups.data?.running ?? null
  const busy = create.isPending || running != null
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })

  const start = () =>
    create.mutate(
      { include_media: includeMedia },
      {
        onSuccess: ({ backup }) =>
          toast.success("Backup created", {
            description: `${formatBytes(backup.size)}. Download it from the list and store it safely.`,
          }),
        onError: (e) => toast.error("Could not create the backup", { description: formatError(e) }),
        onSettled: refresh,
      },
    )

  return (
    <section
      aria-labelledby="backup-title"
      className="rounded-2xl bg-card border border-border p-5 space-y-4"
    >
      <div className="flex items-start gap-3">
        <Archive className="w-5 h-5 mt-0.5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 space-y-1">
          <h2 id="backup-title" className="text-sm font-medium text-foreground">
            Backup
          </h2>
          <p className="text-xs text-muted-foreground">
            One ZIP with every database table, all proposal JSON and a script that restores the data
            into a new database. Sign-in sessions are left out. The newest {backups.data?.keep ?? 5}{" "}
            backups are kept.
          </p>
        </div>
      </div>

      <div
        role="note"
        className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300"
      >
        <ShieldAlert className="w-4 h-4 mt-px shrink-0" aria-hidden />
        <p>
          The ZIP contains personal data: profiles, comments, drafts, moderation reports and
          security reports with their senders&apos; contact details. Store it as safely as the
          database itself, and delete copies you no longer need.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-start gap-2.5">
          <Checkbox
            id="backup-include-media"
            checked={includeMedia}
            onCheckedChange={(v) => setIncludeMedia(v === true)}
            disabled={busy}
            className="mt-0.5"
          />
          <label htmlFor="backup-include-media" className="text-sm text-foreground">
            Include uploaded files
            <span className="block text-[11px] text-muted-foreground">
              Attachments, thumbnails and avatars. Can be large and slow.
            </span>
          </label>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="sm:ml-auto inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-purple-dim disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          ) : (
            <Archive className="w-3.5 h-3.5" aria-hidden />
          )}
          {busy ? "Creating backup…" : "Create backup"}
        </button>
      </div>

      {busy && <Progress running={running} />}

      {backups.isPending ? (
        <p className="text-sm text-muted-foreground">Loading the backups…</p>
      ) : backups.isError ? (
        <p className="text-sm text-destructive">
          Could not load the backups: {formatError(backups.error)}
        </p>
      ) : backups.data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No backups yet.
        </p>
      ) : (
        <ul aria-label="Backups" className="divide-y divide-border rounded-xl border border-border">
          {backups.data.items.map((b) => (
            <BackupRow key={b.key} backup={b} onDeleted={refresh} />
          ))}
        </ul>
      )}

      <p className="text-[11px] text-muted-foreground">
        One backup every 10 minutes. A download link works for 5 minutes and comes straight from
        storage.
      </p>
    </section>
  )
}

function Progress({ running }: { running: Running | null }) {
  const value = share(running)
  return (
    <div className="space-y-1.5">
      <div
        role="progressbar"
        aria-label="Backup progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        className="h-2 w-full overflow-hidden rounded-full bg-primary/15"
      >
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-[width] duration-500",
            value == null && "w-1/4 animate-pulse",
          )}
          style={value == null ? undefined : { width: `${value}%` }}
        />
      </div>
      <p className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span aria-live="polite">{phaseLabel(running)}</span>
        {running && (
          <span>
            {formatBytes(running.bytes)} written · {elapsed(running.started_at)}
          </span>
        )}
      </p>
    </div>
  )
}

function BackupRow({ backup, onDeleted }: { backup: Backup; onDeleted: () => void }) {
  const remove = useDeleteBackup()
  const [confirming, setConfirming] = useState(false)
  const when = formatUtc(backup.created)

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <div className="min-w-0 grow basis-40">
        <p className="text-sm text-foreground whitespace-nowrap">{when}</p>
        <p className="text-xs text-muted-foreground">{formatBytes(backup.size)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/moderation/backup/download?key=${encodeURIComponent(backup.key)}`}
          aria-label={`Download the backup of ${when}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-1"
        >
          <Download className="w-3.5 h-3.5" aria-hidden />
          Download
        </a>
        {confirming ? (
          <>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(backup.key, {
                  onSuccess: () => toast.success("Backup deleted"),
                  onError: (e) =>
                    toast.error("Could not delete the backup", { description: formatError(e) }),
                  onSettled: () => {
                    setConfirming(false)
                    onDeleted()
                  },
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-destructive bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive disabled:opacity-50"
            >
              {remove.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="w-3.5 h-3.5" aria-hidden />
              )}
              Delete for good
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Delete the backup of ${when}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/5"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden />
            Delete
          </button>
        )}
      </div>
    </li>
  )
}

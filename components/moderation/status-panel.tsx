"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CircleCheck, CircleX, Loader2, RefreshCw, Send, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { formatUtc, type StatusLevel, type StatusReport } from "@/lib/moderation/status"
import { cn } from "@/lib/utils"
import { readApiError } from "@/lib/utils/api-error"
import { formatError } from "@/lib/utils/format-error"

type StatusResponse = StatusReport & { checked_at: string }
type Section = StatusReport["sections"][number]

function useModerationStatus() {
  return useQuery<StatusResponse>({
    queryKey: ["moderation", "status"],
    queryFn: async () => {
      const res = await fetch("/api/moderation/status", { cache: "no-store" })
      if (!res.ok) throw new Error(await readApiError(res))
      return (await res.json()) as StatusResponse
    },
    retry: 1,
  })
}

function useSendTestMessage() {
  return useMutation<unknown, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/moderation/status/test-message", { method: "POST" })
      if (!res.ok) throw new Error(await readApiError(res))
      return res.json()
    },
  })
}

const LEVEL: Record<
  StatusLevel,
  { label: string; count: [string, string]; icon: typeof CircleCheck; tone: string }
> = {
  ok: {
    label: "OK",
    count: ["ok", "ok"],
    icon: CircleCheck,
    tone: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    label: "Warning",
    count: ["warning", "warnings"],
    icon: TriangleAlert,
    tone: "text-amber-600 dark:text-amber-400",
  },
  problem: {
    label: "Problem",
    count: ["problem", "problems"],
    icon: CircleX,
    tone: "text-red-600 dark:text-red-400",
  },
}

export function StatusPanel() {
  const status = useModerationStatus()

  if (status.isPending) return <p className="text-sm text-muted-foreground">Checking…</p>
  if (status.isError) {
    return (
      <p className="text-sm text-destructive">
        Could not load the status: {formatError(status.error)}
      </p>
    )
  }

  const data = status.data
  const counts = { ok: 0, warning: 0, problem: 0 }
  for (const s of data.sections) for (const i of s.items) counts[i.level] += 1

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card border border-border p-4 sm:px-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {(["problem", "warning", "ok"] as const).map((level) => {
            const { icon: Icon, tone, count } = LEVEL[level]
            return (
              <span key={level} className="inline-flex items-center gap-1.5 text-foreground">
                <Icon className={cn("w-4 h-4", tone)} aria-hidden />
                {counts[level]} {count[counts[level] === 1 ? 0 : 1]}
              </span>
            )
          })}
        </div>
        <span className="text-xs text-muted-foreground">
          {data.production ? "Production" : "Development or preview"} · checked{" "}
          {formatUtc(data.checked_at)}
        </span>
        <button
          type="button"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
          className="sm:ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-1 disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", status.isFetching && "animate-spin")} />
          Check again
        </button>
      </div>

      <div className="lg:columns-2 gap-4 [&>section:last-child]:mb-0">
        {data.sections.map((s) => (
          <SectionCard key={s.id} section={s}>
            {s.id === "telegram" && <TestMessage canSend={data.can_send_test} />}
          </SectionCard>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Only whether a setting is present is shown here, never its value.
      </p>
    </div>
  )
}

function SectionCard({ section, children }: { section: Section; children?: React.ReactNode }) {
  return (
    <section className="break-inside-avoid mb-4 rounded-2xl bg-card border border-border p-5 space-y-3">
      <h2 className="text-sm font-medium text-foreground">{section.title}</h2>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {section.items.map((i) => {
          const { icon: Icon, tone, label } = LEVEL[i.level]
          return (
            <li key={i.id} className="flex items-start gap-3 px-3 py-2.5">
              <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", tone)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                  <span className="sr-only">{label}: </span>
                  {i.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {i.hint}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
      {children}
    </section>
  )
}

function TestMessage({ canSend }: { canSend: boolean }) {
  const send = useSendTestMessage()
  const [cooling, setCooling] = useState(false)

  useEffect(() => {
    if (!cooling) return
    const t = setTimeout(() => setCooling(false), 60_000)
    return () => clearTimeout(t)
  }, [cooling])

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <button
        type="button"
        disabled={!canSend || cooling || send.isPending}
        onClick={() =>
          send.mutate(undefined, {
            onSuccess: () => {
              setCooling(true)
              toast.success("Test message sent", {
                description: "Check the moderators' Telegram chat.",
              })
            },
            onError: (e) => toast.error("Could not send", { description: formatError(e) }),
          })
        }
        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {send.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Send className="w-3.5 h-3.5" />
        )}
        Send test message
      </button>
      <span className="text-[11px] text-muted-foreground">
        {!canSend
          ? "Needs the bot token and a moderation chat."
          : cooling
            ? "Sent. The next one can go in a minute."
            : "Goes to the moderation chat. Once a minute."}
      </span>
    </div>
  )
}

/** Shown at the top of the Settings tab while the checks are failing. */
export function ScanHealthBanner() {
  const status = useModerationStatus()
  const h = status.data?.health
  if (!h) return null
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4"
    >
      <TriangleAlert className="w-5 h-5 mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-red-700 dark:text-red-400">
          Automatic checks are failing
        </p>
        <p className="text-sm text-foreground">
          {h.problem} Uploads are posted without a check until this is fixed.
        </p>
        <p className="text-xs text-muted-foreground">
          Since {formatUtc(h.first_seen)} · last seen {formatUtc(h.last_seen)}
        </p>
      </div>
    </div>
  )
}

"use client"

import { useState } from "react"
import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"

export type CallStatus = "pending" | "running" | "ok" | "failed"

type Props = {
  index: number
  status: CallStatus
  /** Plain-English title shown as the card heading. */
  title: string
  /** Pallet name - surfaced inside the expanded technical detail block. */
  pallet: string
  /** Extrinsic method - surfaced inside the expanded technical detail block. */
  method: string
  /** One-line plain-English summary above the args. */
  summary: string
  /** Key/value rows shown when expanded. */
  details: { label: string; value: React.ReactNode }[]
  /** Raw hex / payload that the chain actually sees. Mono-rendered. */
  rawPayload?: string
  defaultOpen?: boolean
}

export function CallCard({
  index,
  status,
  title,
  pallet,
  method,
  summary,
  details,
  rawPayload,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-colors",
        status === "ok" && "border-emerald-500/40",
        status === "running" && "border-primary/50",
        status === "failed" && "border-destructive/50",
        status === "pending" && "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-start gap-3 p-4"
      >
        <StatusBadge status={status} index={index} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {title}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Step {index + 1}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            {summary}
          </p>
        </div>
        <span className="text-muted-foreground mt-0.5">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
          <dl className="space-y-2 text-xs">
            <div className="flex gap-3">
              <dt className="text-muted-foreground w-32 flex-shrink-0">
                Pallet call
              </dt>
              <dd className="text-foreground font-mono break-all leading-relaxed flex-1 min-w-0">
                {pallet}.{method}
              </dd>
            </div>
            {details.map((d) => (
              <div key={d.label} className="flex gap-3">
                <dt className="text-muted-foreground w-32 flex-shrink-0">{d.label}</dt>
                <dd className="text-foreground font-mono break-all leading-relaxed flex-1 min-w-0">
                  {d.value}
                </dd>
              </div>
            ))}
          </dl>

          {rawPayload && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">
                Raw payload ({rawPayload.length} chars)
              </summary>
              <pre className="mt-2 p-2 rounded-md bg-surface-2 text-foreground font-mono text-[11px] whitespace-pre-wrap break-all max-h-40 overflow-auto">
                {rawPayload}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status, index }: { status: CallStatus; index: number }) {
  if (status === "ok") {
    return (
      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      </div>
    )
  }
  if (status === "running") {
    return (
      <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center flex-shrink-0">
        <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
      </div>
    )
  }
  if (status === "failed") {
    return (
      <div className="w-7 h-7 rounded-full bg-destructive/15 border border-destructive/40 flex items-center justify-center flex-shrink-0">
        <X className="w-3.5 h-3.5 text-destructive" />
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-full border border-border text-muted-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
      {index + 1}
    </div>
  )
}

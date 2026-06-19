"use client"

import { AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface LoadErrorProps {
  headline: string
  detail: string
  technical?: string | null
  retry?: () => void
  className?: string
  /** Wrap in a bordered card. Defaults true; pass false when embedding in a card. */
  card?: boolean
}

/**
 * Friendly load-failure surface. Hides the raw error message behind a
 * collapsed disclosure so debugging info stays available without
 * shouting at the user.
 */
export function LoadError({
  headline,
  detail,
  technical,
  retry,
  className,
  card = true,
}: LoadErrorProps) {
  return (
    <div
      className={cn(
        card && "rounded-2xl bg-card border border-border p-10",
        "text-center space-y-3",
        className,
      )}
    >
      <div className="mx-auto w-12 h-12 rounded-2xl bg-surface-2 border border-border flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-muted-foreground" />
      </div>
      <p className="text-foreground font-medium text-base">{headline}</p>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
        {detail}
      </p>
      {retry && (
        <div className="pt-1">
          <button
            onClick={retry}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors"
          >
            Try again
          </button>
        </div>
      )}
      {technical && (
        <details className="text-left max-w-md mx-auto pt-3">
          <summary className="text-xs text-muted-foreground/70 hover:text-muted-foreground cursor-pointer select-none inline-block">
            Show technical details
          </summary>
          <pre className="mt-2 text-[11px] p-3 rounded-lg bg-surface-2 border border-border text-muted-foreground whitespace-pre-wrap break-all font-mono">
            {technical}
          </pre>
        </details>
      )}
    </div>
  )
}

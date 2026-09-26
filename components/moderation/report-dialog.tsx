"use client"

import { useState } from "react"
import Link from "next/link"
import { Flag, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { useReport } from "@/lib/query/hooks/use-moderation"
import { useMe } from "@/lib/query/hooks/use-session"
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  type ModerationTarget,
  type ReportCategory,
} from "@/lib/moderation/policy"
import { cn } from "@/lib/utils"
import { formatError } from "@/lib/utils/format-error"

const NOUN: Record<ModerationTarget, string> = {
  proposal: "proposal",
  attachment: "image",
  comment: "comment",
}

/**
 * "Report this …" sheet. Anyone signed in can report a proposal, an image
 * or a comment; moderators review every report and the reporter's name
 * isn't shown publicly.
 */
export function ReportDialog({
  target,
  onClose,
}: {
  target: { type: ModerationTarget; id: string } | null
  onClose: () => void
}) {
  const me = useMe()
  const report = useReport()
  const [category, setCategory] = useState<ReportCategory | null>(null)
  const [note, setNote] = useState("")

  const close = () => {
    setCategory(null)
    setNote("")
    onClose()
  }

  const submit = () => {
    if (!target || !category) return
    report.mutate(
      { target_type: target.type, target_id: target.id, category, note: note.trim() || null },
      {
        onSuccess: (r) => {
          toast.success(r.duplicate ? "You already reported this" : "Report sent", {
            description: "Moderators review every report.",
          })
          close()
        },
        onError: (e) => toast.error("Could not send the report", { description: formatError(e) }),
      },
    )
  }

  const nextPath =
    typeof window === "undefined" ? "/" : window.location.pathname + window.location.search

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogTitle className="flex items-center gap-2 text-base">
          <Flag className="w-4 h-4" />
          Report this {target ? NOUN[target.type] : "item"}
        </DialogTitle>
        <DialogDescription className="text-xs">
          Moderators review every report. Your name isn&apos;t shown publicly.
        </DialogDescription>

        {!me.data ? (
          <p className="text-sm text-muted-foreground">
            Sign in to report content.{" "}
            <Link
              href={`/account?next=${encodeURIComponent(nextPath)}`}
              className="text-primary hover:text-purple-dim"
            >
              Sign in on your account page
            </Link>
          </p>
        ) : (
          <>
            <div role="radiogroup" className="grid grid-cols-2 gap-2">
              {REPORT_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={category === c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                    category === c
                      ? "border-purple-border bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-3 w-3 flex-shrink-0 rounded-full border",
                      category === c ? "border-primary bg-primary" : "border-muted-foreground",
                    )}
                  />
                  {REPORT_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Anything moderators should know (optional)"
              className="w-full rounded-xl border border-border bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!category || report.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-purple-dim disabled:opacity-50"
            >
              {report.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Send report
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

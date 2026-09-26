"use client"

import Link from "next/link"
import { Ban, Eye } from "lucide-react"
import type { ModerationInfo } from "@/lib/query/hooks/use-moderation"
import { cn } from "@/lib/utils"

export function isWithheld(info: ModerationInfo | null | undefined): boolean {
  return info?.state === "hidden" || info?.state === "removed"
}

function who(info: ModerationInfo): string {
  if (info.source === "proposer") return "Removed by the proposer"
  if (info.state === "hidden") return "Hidden by moderators"
  return "Removed by moderators"
}

/** Placeholder where a hidden or removed image used to be. */
export function WithheldMedia({ info, className }: { info: ModerationInfo; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-surface-1 p-3 text-center",
        className,
      )}
    >
      <Ban className="w-4 h-4 text-muted-foreground" />
      <p className="text-xs font-medium text-foreground">{who(info)}</p>
      {info.reason && info.source !== "proposer" && (
        <p className="text-[11px] text-muted-foreground line-clamp-2">Reason: {info.reason}</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {new Date(info.updated_at).toLocaleDateString(undefined, { dateStyle: "medium" })} ·{" "}
        <Link href="/moderation-log" className="text-primary hover:text-purple-dim">
          view log
        </Link>
      </p>
    </div>
  )
}

/** Cover over a blurred image until the reader chooses to see it. */
export function SensitiveCover({
  onReveal,
  className,
}: {
  onReveal: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onReveal()
      }}
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/30 text-white backdrop-blur-xl",
        className,
      )}
    >
      <Eye className="w-4 h-4" />
      <span className="text-xs font-medium">Sensitive · tap to show</span>
    </button>
  )
}

/** Banner above a proposal a moderator hid. */
export function HiddenProposalBanner({
  info,
  shown,
  onShow,
}: {
  info: ModerationInfo
  shown: boolean
  onShow: () => void
}) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed">
      <p className="font-medium text-foreground">Hidden by moderators</p>
      {info.reason && <p className="text-muted-foreground mt-0.5">Reason: {info.reason}</p>}
      <p className="text-muted-foreground mt-0.5">
        The referendum and its votes are unaffected.{" "}
        <Link href="/moderation-log" className="text-primary hover:text-purple-dim">
          Moderation log
        </Link>
        {!shown && (
          <>
            {" · "}
            <button type="button" onClick={onShow} className="text-primary hover:text-purple-dim">
              Show the text anyway
            </button>
          </>
        )}
      </p>
    </div>
  )
}

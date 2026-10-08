"use client"

import { Pencil, X } from "lucide-react"
import { toast } from "sonner"
import type { ChainId } from "@/lib/chain/chains"
import {
  useCancelDraft,
  useMyDrafts,
  type MyDraft,
} from "@/lib/query/hooks/use-my-drafts"
import { formatError } from "@/lib/utils/format-error"

type Props = {
  address: string | null
  network: ChainId
}

/**
 * Lists prior proposal drafts by the connected address. Surfaces:
 *   - `draft` rows whose Submit step was abandoned (R2 + DB exist,
 *     no signing happened),
 *   - `submitted` rows that were broadcast but never confirmed
 *     (likely never made it into a block - e.g. duplicate batches).
 *
 * Each comes with a "Cancel" action that flips the row to 'cancelled' in
 * our DB. The R2 JSON stays - anyone who has the URL can still read it - but
 * the proposal stops showing up in any "open drafts" list.
 */
export function MyDraftsPanel({ address, network }: Props) {
  const draftsQuery = useMyDrafts(address, undefined)
  const cancel = useCancelDraft()

  const stale = (draftsQuery.data ?? []).filter(
    (d) => d.status === "draft" || d.status === "submitted",
  )

  if (!address || stale.length === 0) return null

  return (
    <div className="rounded-xl bg-amber-500/5 border border-amber-500/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          You have {stale.length} unfinished draft{stale.length === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          Resume one to pick up where you left off, or cancel it so it stops
          showing here. Cancelling only affects our database - the on-chain
          referendum (if one exists) is not touched.
        </p>
      </div>
      <ul className="space-y-2">
        {stale.map((d) => (
          <DraftRow
            key={d.id}
            draft={d}
            network={network}
            onCancel={() =>
              cancel.mutate(
                { id: d.id, reason: "Cancelled from create wizard" },
                {
                  onSuccess: () => toast.success("Draft cancelled"),
                  onError: (e) =>
                    toast.error("Could not cancel draft", {
                      description: formatError(e),
                    }),
                },
              )
            }
            busy={cancel.isPending}
          />
        ))}
      </ul>
    </div>
  )
}

function DraftRow({
  draft,
  network: _network,
  onCancel,
  busy,
}: {
  draft: MyDraft
  network: ChainId
  onCancel: () => void
  busy: boolean
}) {
  const statusLabel =
    (draft.status === "draft" ? "Not signed" : "Broadcast - not finalised") +
    (draft.has_spend ? "" : " · advanced proposal")
  // Full navigation (not a client-side Link) so the draft reliably reloads
  // even when we're already on /create - the wizard reads `?from=` on mount.
  const resumeHref =
    `/create?from=${draft.id}` +
    (draft.status === "submitted" ? "&go=review" : "")
  return (
    <li className="flex items-center gap-3 p-3 rounded-lg bg-surface-1 border border-border">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{draft.title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {statusLabel} · {new Date(draft.created_at).toLocaleString()}
        </p>
      </div>
      {draft.has_spend && (
        <a
          href={resumeHref}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 text-primary border border-purple-border text-[11px] font-medium hover:bg-primary/20 transition-colors"
          title="Resume this draft"
        >
          <Pencil className="w-3 h-3" />
          Resume
        </a>
      )}
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50"
        title="Cancel this draft"
      >
        <X className="w-3 h-3" />
        Cancel
      </button>
    </li>
  )
}

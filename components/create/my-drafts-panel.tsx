"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Link2, Pencil, X } from "lucide-react"
import { toast } from "sonner"
import type { ChainId } from "@/lib/chain/chains"
import {
  useCancelDraft,
  useLinkDraft,
  useMyDrafts,
  type MyDraft,
} from "@/lib/query/hooks/use-my-drafts"
import { useMe } from "@/lib/query/hooks/use-session"
import { formatError } from "@/lib/utils/format-error"

type Props = {
  address: string | null
  network: ChainId
  /**
   * Resolves a signed-in session (prompting the wallet if needed). Cancel
   * and link are write endpoints, so they run it first instead of failing
   * with a 401.
   */
  ensureSignedIn?: (opts?: { fresh?: boolean }) => Promise<boolean>
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
 * the proposal stops showing up in any "open drafts" list. A draft whose
 * submission did land but never got linked can be linked to its referendum
 * by index.
 */
export function MyDraftsPanel({ address, network, ensureSignedIn }: Props) {
  const router = useRouter()
  const me = useMe()
  const draftsQuery = useMyDrafts(address, undefined)
  const cancel = useCancelDraft()
  const link = useLinkDraft()

  const stale = (draftsQuery.data ?? []).filter(
    (d) => d.status === "draft" || d.status === "submitted",
  )

  if (!address) return null
  // Drafts are private: signed out, the list can't include them.
  if (me.data === null && ensureSignedIn) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-1 px-4 py-2.5 text-xs text-muted-foreground">
        <span>Saved drafts are private. Sign in to see yours.</span>
        <button
          type="button"
          onClick={() => void ensureSignedIn()}
          className="font-medium text-primary hover:text-purple-dim"
        >
          Sign in
        </button>
      </div>
    )
  }
  if (stale.length === 0) return null

  // Sign in on the spot; only if that fails, offer the account page (the
  // form on this page isn't saved, so we never navigate away on our own).
  const signedIn = async (): Promise<boolean> => {
    if (!ensureSignedIn || (await ensureSignedIn())) return true
    toast.error("Sign-in needed", {
      description: "Approve the sign-in message in your wallet, or sign in on your account page.",
      action: {
        label: "Account",
        onClick: () => router.push("/account?next=/create"),
      },
    })
    return false
  }

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
            busy={cancel.isPending || link.isPending}
            onCancel={async () => {
              if (!(await signedIn())) return
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
            }}
            onLink={async (referendumIndex) => {
              if (!(await signedIn())) return
              link.mutate(
                {
                  id: d.id,
                  referendumIndex,
                  onUnauthorized: ensureSignedIn ? () => ensureSignedIn({ fresh: true }) : undefined,
                },
                {
                  onSuccess: () =>
                    toast.success(`Linked to referendum #${referendumIndex}`),
                  onError: (e) =>
                    toast.error("Could not link draft", {
                      description: formatError(e),
                    }),
                },
              )
            }}
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
  onLink,
  busy,
}: {
  draft: MyDraft
  network: ChainId
  onCancel: () => void
  onLink: (referendumIndex: number) => void
  busy: boolean
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [indexInput, setIndexInput] = useState("")
  const index = Number(indexInput)
  const indexValid = indexInput.trim() !== "" && Number.isInteger(index) && index >= 0

  const statusLabel =
    draft.status === "draft" ? "Not submitted" : "Broadcast - not finalised"
  // Full navigation (not a client-side Link) so the draft reliably reloads
  // even when we're already on /create - the wizard reads `?from=` on mount.
  const resumeHref =
    `/create?from=${draft.id}` +
    (draft.status === "submitted" ? "&go=review" : "")
  return (
    <li className="p-3 rounded-lg bg-surface-1 border border-border space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground truncate">{draft.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {statusLabel} · {new Date(draft.created_at).toLocaleString()}
          </p>
        </div>
        {draft.is_treasury !== false && (
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
      </div>
      {linkOpen ? (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Referendum #</span>
          <input
            type="text"
            inputMode="numeric"
            value={indexInput}
            onChange={(e) => setIndexInput(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="e.g. 212"
            className="w-24 px-2 py-1 rounded-md bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={() => onLink(index)}
            disabled={!indexValid || busy}
            className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium disabled:opacity-50"
          >
            Link
          </button>
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>
      ) : (
        draft.status === "draft" && (
          <button
            type="button"
            onClick={() => setLinkOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
          >
            <Link2 className="w-3 h-3" />
            Already on chain? Link it to its referendum
          </button>
        )
      )}
    </li>
  )
}

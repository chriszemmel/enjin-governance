"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileJson, Flag, MoreHorizontal } from "lucide-react"
import { ProposalBody } from "@/components/governance/proposal-body"
import { ReportDialog } from "@/components/moderation/report-dialog"
import { HiddenProposalBanner } from "@/components/moderation/moderation-notes"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useProposalModeration } from "@/lib/query/hooks/use-moderation"
import type { ModerationTarget } from "@/lib/moderation/policy"
import { ProposalSourceModal } from "@/components/governance/proposal-source-modal"
import type { ChainConfig } from "@/lib/chain/chains"
import type { ProposalMetadata } from "@/lib/query/hooks/use-proposal-metadata"
import { stringifyStable } from "@/lib/r2/json"
import type { ProposalJson } from "@/lib/governance/proposal-metadata"
import { resolveProposalMedia } from "@/lib/governance/proposal-media"

type Props = {
  metadata: ProposalMetadata
  chain: ChainConfig
}

/**
 * Renders the title / summary / body / attachments pulled from the
 * proposer's R2-pinned JSON. Verifies the sha256 against the URL
 * declared in our DB so a tampered bucket can't silently change a
 * referendum's narrative - if the hash mismatches we still render but
 * with a clear warning badge.
 */
export function ProposalMetadataHeader({ metadata, chain }: Props) {
  const jsonQuery = useQuery<{ json: ProposalJson; verified: boolean }>({
    queryKey: ["proposal-json", metadata.id, metadata.json_sha256],
    queryFn: async () => {
      // Go through the server-side proxy by default - bypasses R2 CORS
      // entirely. If that ever fails (e.g. our API is down) we fall
      // back to the direct bucket URL, which works for buckets that
      // do have a permissive Access-Control-Allow-Origin set.
      // cache: "no-store" skips the browser HTTP cache so a proposer
      // edit becomes visible the moment React Query refetches. We
      // also tack the DB sha256 onto the URL so a fresh sha256 cache-
      // busts any intermediate cache that we don't control.
      let raw: string
      try {
        const proxied = await fetch(
          `/api/proposals/${metadata.id}/json?v=${metadata.json_sha256}`,
          { cache: "no-store" },
        )
        if (!proxied.ok) throw new Error(`Proxy HTTP ${proxied.status}`)
        raw = await proxied.text()
      } catch {
        const direct = await fetch(metadata.json_url, { cache: "no-store" })
        if (!direct.ok) throw new Error(`HTTP ${direct.status}`)
        raw = await direct.text()
      }
      const json = JSON.parse(raw) as ProposalJson
      // Hash the canonical form and check against what's pinned in the
      // DB row. The DB row's sha256 was computed at upload time, so a
      // mismatch means either the bucket content was edited after the
      // fact (R2 perms issue) or the canonicalisation differs across
      // serialisers.
      const canonical = stringifyStable(json)
      const bytes = new TextEncoder().encode(canonical)
      const hashBuf = await crypto.subtle.digest("SHA-256", bytes)
      const hashHex = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      return { json, verified: hashHex === metadata.json_sha256 }
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  })

  const json = jsonQuery.data?.json
  const verified = jsonQuery.data?.verified ?? false
  const edited = Boolean(metadata.edited_at)
  const [sourceOpen, setSourceOpen] = useState(false)

  // Only files in this proposal's own folder are shown, loaded through /r.
  const media = useMemo(
    () => resolveProposalMedia(json?.attachments ?? [], metadata.network, metadata.id),
    [json?.attachments, metadata.network, metadata.id],
  )
  const moderationQuery = useProposalModeration(metadata.id)
  const moderation = moderationQuery.data
  const hiddenInfo = moderation?.proposal?.state === "hidden" ? moderation.proposal : null
  const [showHidden, setShowHidden] = useState(false)
  const [reporting, setReporting] = useState<{ type: ModerationTarget; id: string } | null>(null)

  const hasBody = Boolean(json?.body_markdown)
  const hasAttachments = media.length > 0
  // The hero card now owns title + summary. If the JSON brings nothing
  // additional, drop the card entirely so we don't render an empty
  // "About" panel with just a verification badge.
  if (!hasBody && !hasAttachments && !jsonQuery.isLoading && !jsonQuery.isError) {
    return null
  }

  return (
    <div className="rounded-2xl bg-card border border-border p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-foreground">About</h2>
        <div className="flex items-center gap-1.5">
          <SourceBadge
            verified={verified}
            edited={edited}
            loading={jsonQuery.isLoading}
            error={jsonQuery.isError}
            onClick={() => setSourceOpen(true)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label="More"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setReporting({ type: "proposal", id: metadata.id })}>
                <Flag className="w-3.5 h-3.5" />
                Report this proposal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {hiddenInfo && (
        <HiddenProposalBanner
          info={hiddenInfo}
          shown={showHidden}
          onShow={() => setShowHidden(true)}
        />
      )}
      <ReportDialog target={reporting} onClose={() => setReporting(null)} />

      <ProposalSourceModal
        open={sourceOpen}
        onOpenChange={setSourceOpen}
        metadata={metadata}
        chain={chain}
        verified={verified}
        loading={jsonQuery.isLoading}
        error={jsonQuery.isError}
      />

      {json && (!hiddenInfo || showHidden) && (
        <ProposalBody
          body={json.body_markdown ?? ""}
          media={media}
          moderation={moderation?.attachments}
          onReportImage={(m) => setReporting({ type: "attachment", id: m.key })}
        />
      )}
    </div>
  )
}

function SourceBadge({
  verified,
  edited,
  loading,
  error,
  onClick,
}: {
  verified: boolean
  /**
   * True when the proposer overwrote the JSON post-submission. Wins
   * over `verified` for the badge tone so readers always see that an
   * edit happened - even when the bucket sha256 currently matches our
   * (post-edit) DB record. The on-chain pinned sha256 still diverges,
   * which is the actual integrity signal external indexers check.
   */
  edited: boolean
  loading: boolean
  error: boolean
  onClick: () => void
}) {
  const { tone, label } = sourceBadgeState({ verified, edited, loading, error })

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium transition-colors hover:opacity-80 ${tone}`}
      title="EGOV1 source details"
    >
      <FileJson className="w-3 h-3" />
      {label}
    </button>
  )
}

/**
 * Single source of truth for the EGOV1 badge's label + tone classes.
 *
 * Precedence is fixed (highest → lowest):
 *   1. error    → Fetch Failed (amber, transport issue)
 *   2. loading  → Loading      (neutral, in-flight)
 *   3. edited   → Edited       (purple, proposer changed bytes after
 *                               submission; on-chain pin no longer
 *                               matches the bucket)
 *   4. verified → Verified     (emerald, bucket matches DB and the
 *                               on-chain pinned sha256)
 *   5. else     → Unverified   (red, bucket doesn't match DB and no
 *                               edit recorded - treat as tamper)
 *
 * The docs page renders structurally-identical sample chips so the
 * legend in app/docs/page.tsx stays a faithful colour reference; if
 * tones change here, mirror the change there too.
 */
function sourceBadgeState({
  verified,
  edited,
  loading,
  error,
}: {
  verified: boolean
  edited: boolean
  loading: boolean
  error: boolean
}): { tone: string; label: string } {
  if (error) {
    return {
      tone: "border-amber-500/40 text-amber-800 dark:text-amber-300 bg-amber-500/5",
      label: "EGOV1 · Fetch Failed",
    }
  }
  if (loading) {
    return {
      tone: "border-border text-muted-foreground bg-surface-1",
      label: "EGOV1 · Loading",
    }
  }
  if (edited) {
    return {
      tone: "border-purple-border text-primary bg-primary/5",
      label: "EGOV1 · Edited",
    }
  }
  if (verified) {
    return {
      tone: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5",
      label: "EGOV1 · Verified",
    }
  }
  return {
    tone: "border-red-500/40 text-red-700 dark:text-red-400 bg-red-500/5",
    label: "EGOV1 · Unverified",
  }
}

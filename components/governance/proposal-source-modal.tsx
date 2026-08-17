"use client"

import { useState } from "react"
import {
  Check,
  ChevronDown,
  ExternalLink,
  FileJson,
  Info,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  type ChainConfig,
  subscanReferendumUrl,
} from "@/lib/chain/chains"
import type { ProposalMetadata } from "@/lib/query/hooks/use-proposal-metadata"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  metadata: ProposalMetadata
  chain: ChainConfig
  /** Whether the bucket bytes hashed to our DB-recorded sha256. */
  verified: boolean
  /** True while the bucket fetch is in flight. */
  loading: boolean
  /** True if the bucket fetch failed. */
  error: boolean
}

type StatusTone = "ok" | "warn" | "info" | "alert" | "neutral"

/**
 * Detail sheet for the EGOV1 source badge. Leads with the verification
 * status and the data a reader actually needs (referendum + sha256 +
 * links out); the long-form EGOV1 explainer sits behind a "What is
 * this?" expander so the modal doesn't read like the docs page.
 */
export function ProposalSourceModal({
  open,
  onOpenChange,
  metadata,
  chain,
  verified,
  loading,
  error,
}: Props) {
  const subscanUrl = subscanReferendumUrl(chain, metadata.referendum_index)
  const edited = Boolean(metadata.edited_at)
  // Precedence: edited beats verified so readers always see when the
  // proposer changed bytes after submission, and unverified surfaces
  // as an alert rather than blending into neutral chrome.
  const status: { label: string; tone: StatusTone; line: string } = error
    ? {
        label: "Fetch failed",
        tone: "warn",
        line: "Couldn't fetch bucket bytes - likely transient.",
      }
    : loading
      ? { label: "Checking", tone: "neutral", line: "Hashing the bucket…" }
      : edited
        ? {
            label: "Edited",
            tone: "info",
            line: verified
              ? "Proposer edited the JSON after submission. The on-chain pointer still pins the original sha256 - divergence is the public signal of an edit."
              : "Bucket sha256 doesn't yet match our DB - likely a stale CDN. Try again in a moment.",
          }
        : verified
          ? {
              label: "Verified",
              tone: "ok",
              line: "Bucket sha256 matches the hash committed on chain at submission.",
            }
          : {
              label: "Unverified",
              tone: "alert",
              line: "Bucket sha256 doesn't match the on-chain hash and no edit is recorded. Treat the narrative with caution.",
            }

  const [explainerOpen, setExplainerOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-3rem)] max-w-[calc(100%-3rem)] sm:max-w-md max-h-[85vh] p-5 sm:p-6 gap-4 rounded-2xl flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-primary" />
            EGOV1 source
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
          <StatusBlock status={status} />

          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Referendum</dt>
            <dd className="font-mono text-foreground">
              #{metadata.referendum_index} on {chain.shortName}
            </dd>
            <dt className="text-muted-foreground">sha256</dt>
            <dd className="font-mono text-foreground break-all">
              {metadata.json_sha256}
            </dd>
            {edited && (
              <>
                <dt className="text-muted-foreground">Edited</dt>
                <dd className="font-mono text-foreground">
                  {metadata.edited_at
                    ? new Date(metadata.edited_at).toLocaleString()
                    : "-"}
                  {metadata.edit_count > 1 && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {metadata.edit_count} edits
                    </span>
                  )}
                </dd>
              </>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <a
              href={subscanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:text-purple-dim"
            >
              <ExternalLink className="w-3 h-3" />
              View on Subscan
            </a>
            <a
              href={metadata.json_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:text-purple-dim"
            >
              <ExternalLink className="w-3 h-3" />
              Raw JSON
            </a>
          </div>

          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setExplainerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={explainerOpen}
            >
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform",
                  explainerOpen && "rotate-180",
                )}
              />
              {explainerOpen ? "Hide explainer" : "What is EGOV1?"}
            </button>
            {explainerOpen && (
              <div className="text-[11px] leading-relaxed text-muted-foreground space-y-2 mt-3">
                <p>
                  An off-chain metadata standard for attaching a title,
                  summary, body, and attachments to a referendum without
                  bloating chain state.
                </p>
                <p>
                  The submission batch notes a preimage with payload{" "}
                  <code className="font-mono text-foreground break-all">
                    EGOV1:{"{"}&quot;u&quot;:&quot;…&quot;,&quot;h&quot;:&quot;…&quot;{"}"}
                  </code>{" "}
                  - a content-addressed pointer to the bucket JSON - and
                  binds it to the referendum with{" "}
                  <code className="font-mono text-foreground">
                    referenda.setMetadata
                  </code>
                  . Any indexer can rebuild the corpus by resolving{" "}
                  <code className="font-mono text-foreground">
                    referenda.metadataOf
                  </code>{" "}
                  (older referenda used a{" "}
                  <code className="font-mono text-foreground">
                    system.remark
                  </code>{" "}
                  in the same batch instead).
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusBlock({
  status,
}: {
  status: { label: string; tone: StatusTone; line: string }
}) {
  const toneClass = {
    ok: "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
    warn: "border-amber-500/40 text-amber-300 bg-amber-500/5",
    info: "border-purple-border text-primary bg-primary/5",
    alert: "border-red-500/40 text-red-400 bg-red-500/5",
    neutral: "border-border text-muted-foreground bg-surface-1",
  }[status.tone]

  return (
    <div className={cn("rounded-xl border p-3 space-y-1.5", toneClass)}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
        {status.tone === "ok" ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Info className="w-3.5 h-3.5" />
        )}
        EGOV1 · {status.label}
      </div>
      <p className="text-xs leading-relaxed text-foreground/90">
        {status.line}
      </p>
    </div>
  )
}

"use client"

import { ChevronDown, ChevronRight, ExternalLink, FileCode } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { usePreimage } from "@/lib/query/hooks/use-preimage"
import { useActiveChain } from "@/lib/chain/use-chain"
import { PreimageInlineSkeleton } from "./skeletons"
import { subscanPreimageUrl } from "@/lib/chain/chains"
import type { PreimageRef } from "@/lib/governance/types"

interface PreimageDisplayProps {
  preimageRef: PreimageRef
  className?: string
}

/**
 * Renders the decoded call inside a preimage: section.method + args.
 * Falls back to a Subscan deep link when the preimage has been unnoted
 * from chain state (typical for finalised referenda older than the
 * chain's preimage TTL, where the depositor has reclaimed the deposit).
 */
export function PreimageDisplay({ preimageRef, className }: PreimageDisplayProps) {
  const chain = useActiveChain()
  const preimageQuery = usePreimage(preimageRef)
  // Default to collapsed - the preimage block is rarely useful at a
  // glance, and the proposal narrative + tally are the headline.
  const [expanded, setExpanded] = useState(false)

  const data = preimageQuery.data
  const isMissing = preimageQuery.isSuccess && data?.bytes == null
  const hasCall = data && data.bytes != null && data.section && data.method
  const preimageLink = subscanPreimageUrl(chain, preimageRef.hash)

  return (
    <div className={cn("space-y-3", className)}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        disabled={!hasCall && !isMissing && !preimageQuery.isPending}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileCode className="w-4 h-4 text-primary" />
          Preimage
          {hasCall && (
            <span className="font-mono text-xs text-muted-foreground font-normal ml-1">
              {data.section}.{data.method}
            </span>
          )}
        </h3>
        <span className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
          {expanded ? "Collapse" : "Expand"}
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </span>
      </button>

      {preimageQuery.isPending && expanded && <PreimageInlineSkeleton />}

      {expanded && hasCall && (
        <>
          <div className="rounded-lg bg-surface-2 border border-border p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Call
            </p>
            <p className="font-mono text-sm text-foreground">
              <span className="text-primary">{data.section}</span>
              <span className="text-muted-foreground">.</span>
              <span>{data.method}</span>
            </p>
          </div>

          {Object.keys(data.args).length > 0 && (
            <div className="rounded-lg bg-surface-2 border border-border p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Arguments
              </p>
              {Object.entries(data.args).map(([key, value]) => (
                <div key={key} className="text-xs">
                  <p className="text-muted-foreground mb-0.5">{key}</p>
                  <pre className="font-mono text-foreground break-all whitespace-pre-wrap text-[11px] leading-snug">
                    {formatArgValue(value)}
                  </pre>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg bg-surface-2 border border-border p-3 text-[11px] text-muted-foreground space-y-1 font-mono break-all">
            <p>
              <span className="not-italic text-muted-foreground/70 mr-1.5 font-sans">
                Hash
              </span>
              {preimageRef.hash}
            </p>
            {preimageRef.len > 0 && (
              <p>
                <span className="not-italic text-muted-foreground/70 mr-1.5 font-sans">
                  Length
                </span>
                {preimageRef.len} bytes
              </p>
            )}
          </div>
        </>
      )}

      {expanded && isMissing && (
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 space-y-2.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Call bytes are no longer on chain - the proposer reclaimed
            the preimage deposit after the referendum decided. The
            decoded call is still on Subscan&apos;s indexer.
          </p>
          <a
            href={preimageLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View preimage on Subscan
            <ExternalLink className="w-3 h-3" />
          </a>
          <p className="text-[10px] text-muted-foreground leading-relaxed pt-2 border-t border-amber-500/15">
            Tip for operators: set <code className="font-mono">SUBSCAN_API_KEY</code>{" "}
            on the server to surface decoded calls inline (Subscan
            disabled anonymous API access).
          </p>
        </div>
      )}
    </div>
  )
}

function formatArgValue(value: unknown): string {
  if (value == null) return "null"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  if (typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

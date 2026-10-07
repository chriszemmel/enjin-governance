"use client"

import { ChevronDown, ChevronRight, ExternalLink, FileCode } from "lucide-react"
import { useState } from "react"
import { u8aToHex } from "@polkadot/util"
import { cn } from "@/lib/utils"
import { useInlineCall, usePreimage } from "@/lib/query/hooks/use-preimage"
import { useActiveChain } from "@/lib/chain/use-chain"
import { PreimageInlineSkeleton } from "./skeletons"
import { subscanPreimageUrl } from "@/lib/chain/chains"
import type { PreimageRef } from "@/lib/governance/types"

type PreimageDisplayProps = {
  className?: string
} & (
  | { preimageRef: PreimageRef; inlineBytes?: never; inlineAt?: never }
  /**
   * A call that rides inline in its referendum - decoded, never fetched.
   * `inlineAt` is the block the bytes were read at, for a decided
   * referendum (see useInlineCall).
   */
  | { inlineBytes: Uint8Array; inlineAt?: number | null; preimageRef?: never }
)

/**
 * Renders the decoded call inside a preimage: section.method + args.
 * Falls back to a Subscan deep link when the preimage has been unnoted
 * from chain state (typical for finalised referenda older than the
 * chain's preimage TTL, where the depositor has reclaimed the deposit).
 * Inline proposals carry their call bytes in the referendum itself, so
 * they never go missing - when they don't decode, the raw call is shown.
 */
export function PreimageDisplay({
  preimageRef,
  inlineBytes,
  inlineAt,
  className,
}: PreimageDisplayProps) {
  const chain = useActiveChain()
  const lookupQuery = usePreimage(preimageRef)
  const inlineQuery = useInlineCall(inlineBytes, inlineAt)
  const preimageQuery = inlineBytes ? inlineQuery : lookupQuery
  // Default to collapsed - the preimage block is rarely useful at a
  // glance, and the proposal narrative + tally are the headline.
  const [expanded, setExpanded] = useState(false)

  const data = preimageQuery.data
  const isMissing = preimageQuery.isSuccess && data?.bytes == null
  const hasCall = data && data.bytes != null && data.section && data.method
  const decodeFailed = !!inlineBytes && inlineQuery.isError
  const preimageLink = preimageRef ? subscanPreimageUrl(chain, preimageRef.hash) : null
  const hash = data?.hash ?? preimageRef?.hash
  const len = data?.len ?? preimageRef?.len ?? 0

  return (
    <div className={cn("space-y-3", className)}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        disabled={!hasCall && !isMissing && !decodeFailed && !preimageQuery.isPending}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileCode className="w-4 h-4 text-primary" />
          {inlineBytes ? "Call (inline)" : "Preimage"}
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
              {hash}
            </p>
            {len > 0 && (
              <p>
                <span className="not-italic text-muted-foreground/70 mr-1.5 font-sans">
                  Length
                </span>
                {len} bytes
              </p>
            )}
          </div>
        </>
      )}

      {expanded && decodeFailed && (
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 space-y-1.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Couldn&apos;t decode this call with the chain&apos;s metadata. The
            raw call:
          </p>
          <p className="font-mono text-[11px] text-foreground break-all">
            {u8aToHex(inlineBytes)}
          </p>
        </div>
      )}

      {expanded && isMissing && preimageLink && (
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

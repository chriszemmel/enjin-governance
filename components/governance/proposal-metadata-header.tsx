"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileJson, Paperclip } from "lucide-react"
import { ProposalSourceModal } from "@/components/governance/proposal-source-modal"
import type { ChainConfig } from "@/lib/chain/chains"
import type { ProposalMetadata } from "@/lib/query/hooks/use-proposal-metadata"
import { stringifyStable } from "@/lib/r2/json"
import type { ProposalJson } from "@/lib/governance/proposal-metadata"

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

  const hasBody = Boolean(json?.body_markdown)
  const hasAttachments = (json?.attachments?.length ?? 0) > 0
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
        <SourceBadge
          verified={verified}
          edited={edited}
          loading={jsonQuery.isLoading}
          error={jsonQuery.isError}
          onClick={() => setSourceOpen(true)}
        />
      </div>

      <ProposalSourceModal
        open={sourceOpen}
        onOpenChange={setSourceOpen}
        metadata={metadata}
        chain={chain}
        verified={verified}
        loading={jsonQuery.isLoading}
        error={jsonQuery.isError}
      />

      {json?.body_markdown && (
        <div className="text-foreground">
          <MarkdownLite source={json.body_markdown} />
        </div>
      )}

      {json && json.attachments.length > 0 && (
        <div className="pt-3 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Attachments ({json.attachments.length})
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {json.attachments.map((att) => (
              <li
                key={att.url}
                className="flex items-center gap-2 p-2 rounded-lg bg-surface-1 border border-border"
              >
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <a
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-foreground hover:text-primary truncate flex-1 min-w-0"
                >
                  {att.name}
                </a>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {(att.size_bytes / 1024).toFixed(0)} KB
                </span>
              </li>
            ))}
          </ul>
        </div>
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
      tone: "border-amber-500/40 text-amber-300 bg-amber-500/5",
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
      tone: "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
      label: "EGOV1 · Verified",
    }
  }
  return {
    tone: "border-red-500/40 text-red-400 bg-red-500/5",
    label: "EGOV1 · Unverified",
  }
}

/**
 * Tiny markdown renderer that handles enough for proposal bodies:
 *
 *   block-level: paragraphs (blank-line separated), unordered lists
 *     (- or *), ordered lists (1. 2. …), ATX headings (# / ## / ###),
 *     fenced code blocks (```).
 *   inline:      **bold**, *italic*, `code`, [label](url), <url>.
 *
 * Avoids pulling a full markdown lib into the bundle for what are
 * usually a few hundred lines of prose. All output goes through React
 * children (never dangerouslySetInnerHTML) so user content can't
 * inject markup.
 */
function MarkdownLite({ source }: { source: string }) {
  type Block =
    | { kind: "code"; text: string }
    | { kind: "ul"; items: string[] }
    | { kind: "ol"; items: string[] }
    | { kind: "h1" | "h2" | "h3"; text: string }
    | { kind: "para"; text: string }

  const blocks: Block[] = []
  const lines = source.split(/\r?\n/)
  let paraBuf: string[] = []
  let ulBuf: string[] = []
  let olBuf: string[] = []
  let codeBuf: string[] = []
  let inCode = false

  const flushPara = () => {
    if (paraBuf.length) {
      blocks.push({ kind: "para", text: paraBuf.join(" ") })
      paraBuf = []
    }
  }
  const flushUl = () => {
    if (ulBuf.length) {
      blocks.push({ kind: "ul", items: ulBuf })
      ulBuf = []
    }
  }
  const flushOl = () => {
    if (olBuf.length) {
      blocks.push({ kind: "ol", items: olBuf })
      olBuf = []
    }
  }
  const flushAll = () => {
    flushPara()
    flushUl()
    flushOl()
  }

  for (const rawLine of lines) {
    const line = rawLine
    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push({ kind: "code", text: codeBuf.join("\n") })
        codeBuf = []
        inCode = false
      } else {
        flushAll()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }

    if (line.trim() === "") {
      flushAll()
      continue
    }

    const h1 = /^#\s+(.*)$/.exec(line)
    const h2 = /^##\s+(.*)$/.exec(line)
    const h3 = /^###\s+(.*)$/.exec(line)
    if (h3) {
      flushAll()
      blocks.push({ kind: "h3", text: h3[1]! })
      continue
    }
    if (h2) {
      flushAll()
      blocks.push({ kind: "h2", text: h2[1]! })
      continue
    }
    if (h1) {
      flushAll()
      blocks.push({ kind: "h1", text: h1[1]! })
      continue
    }

    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ol) {
      flushPara()
      flushUl()
      olBuf.push(ol[1]!)
      continue
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line)
    if (ul) {
      flushPara()
      flushOl()
      ulBuf.push(ul[1]!)
      continue
    }

    flushUl()
    flushOl()
    paraBuf.push(line)
  }
  if (inCode && codeBuf.length) {
    blocks.push({ kind: "code", text: codeBuf.join("\n") })
  }
  flushAll()

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.kind === "code") {
          return (
            <pre
              key={i}
              className="p-3 rounded-lg bg-surface-2 border border-border text-xs font-mono overflow-x-auto whitespace-pre"
            >
              {b.text}
            </pre>
          )
        }
        if (b.kind === "ul") {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          )
        }
        if (b.kind === "ol") {
          return (
            <ol key={i} className="list-decimal pl-5 space-y-1">
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          )
        }
        if (b.kind === "h1") {
          return (
            <h2 key={i} className="text-lg font-semibold text-foreground pt-3">
              {renderInline(b.text)}
            </h2>
          )
        }
        if (b.kind === "h2") {
          return (
            <h3 key={i} className="text-base font-semibold text-foreground pt-3">
              {renderInline(b.text)}
            </h3>
          )
        }
        if (b.kind === "h3") {
          return (
            <h4 key={i} className="text-sm font-semibold text-foreground pt-2">
              {renderInline(b.text)}
            </h4>
          )
        }
        return (
          <p key={i} className="text-foreground/90">
            {renderInline(b.text)}
          </p>
        )
      })}
    </div>
  )
}

/**
 * Inline-token renderer: walks the string left-to-right, peeling off
 * the first matching span (code → links → bold → italic) and
 * recursing into nested marks (bold can contain italics, etc).
 *
 * Outputs React nodes directly - no string concatenation, no
 * dangerouslySetInnerHTML - so any user-supplied chars are escaped
 * automatically by React.
 */
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let buf = ""
  let i = 0
  let key = 0
  const flushBuf = () => {
    if (buf) {
      out.push(buf)
      buf = ""
    }
  }

  while (i < text.length) {
    const c = text[i]!

    if (c === "`") {
      const end = text.indexOf("`", i + 1)
      if (end > i) {
        flushBuf()
        out.push(
          <code
            key={key++}
            className="px-1 py-0.5 rounded bg-surface-2 text-[0.9em] font-mono"
          >
            {text.slice(i + 1, end)}
          </code>,
        )
        i = end + 1
        continue
      }
    }

    if (c === "[") {
      const closeBracket = text.indexOf("]", i + 1)
      if (closeBracket > i && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2)
        if (closeParen > closeBracket + 1) {
          const label = text.slice(i + 1, closeBracket)
          const href = text.slice(closeBracket + 2, closeParen)
          if (isSafeUrl(href)) {
            flushBuf()
            out.push(
              <a
                key={key++}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-purple-dim underline-offset-2 hover:underline break-words"
              >
                {renderInline(label)}
              </a>,
            )
            i = closeParen + 1
            continue
          }
        }
      }
    }

    if (c === "<") {
      const end = text.indexOf(">", i + 1)
      if (end > i) {
        const inner = text.slice(i + 1, end)
        if (isSafeUrl(inner)) {
          flushBuf()
          out.push(
            <a
              key={key++}
              href={inner}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-purple-dim underline-offset-2 hover:underline break-all"
            >
              {inner}
            </a>,
          )
          i = end + 1
          continue
        }
      }
    }

    if (c === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2)
      if (end > i + 1) {
        flushBuf()
        out.push(
          <strong key={key++} className="font-semibold text-foreground">
            {renderInline(text.slice(i + 2, end))}
          </strong>,
        )
        i = end + 2
        continue
      }
    }

    if (c === "*") {
      const end = text.indexOf("*", i + 1)
      if (end > i) {
        flushBuf()
        out.push(
          <em key={key++} className="italic">
            {renderInline(text.slice(i + 1, end))}
          </em>,
        )
        i = end + 1
        continue
      }
    }

    buf += c
    i++
  }
  flushBuf()
  return out
}

function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith("/")
}

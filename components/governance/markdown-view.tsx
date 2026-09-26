"use client"

import type { ReactNode } from "react"
import { AddressChip } from "@/components/governance/address-chip"
import { parseMarkdownBlocks } from "@/lib/governance/markdown-lite"
import { isSafeUrl, parseInline, type InlineNode } from "@/lib/governance/markdown-inline"
import { findProposalImage, type ProposalMedia } from "@/lib/governance/proposal-media"
import {
  SensitiveCover,
  WithheldMedia,
  isWithheld,
} from "@/components/moderation/moderation-notes"
import type { ModerationInfo } from "@/lib/query/hooks/use-moderation"

type Props = {
  source: string
  /**
   * The proposal's own attachments (see resolveProposalMedia). Only these
   * can appear as images; any other `![..](..)` renders as a plain link.
   */
  media?: readonly ProposalMedia[]
  onOpenImage?: (m: ProposalMedia) => void
  /** Moderation state per attachment key (blurred / hidden / removed). */
  moderation?: Readonly<Record<string, ModerationInfo>>
  /** Blurred images the reader chose to see. */
  revealed?: ReadonlySet<string>
  onReveal?: (key: string) => void
}

/**
 * Renders a proposal body. Used by the proposal page, the Write / Preview
 * tabs and the Review step, so the preview is exactly what voters get.
 *
 *   block-level: paragraphs, lists, headings, fenced code, GFM tables
 *                (lib/governance/markdown-lite.ts)
 *   inline:      **bold**, *italic*, `code`, links, <url>, images from the
 *                proposal's own attachments, and address chips
 *                (lib/governance/markdown-inline.ts)
 *
 * All output goes through React children (never dangerouslySetInnerHTML),
 * so user content can't inject markup.
 */
export function MarkdownView({
  source,
  media = [],
  onOpenImage,
  moderation = {},
  revealed,
  onReveal,
}: Props) {
  const blocks = parseMarkdownBlocks(source)
  const ctx: Ctx = { media, onOpenImage, moderation, revealed, onReveal }
  const inline = (text: string) => renderNodes(parseInline(text), ctx)

  return (
    <div className="space-y-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
      {blocks.map((b, i) => {
        if (b.kind === "code") {
          return (
            <pre
              key={i}
              className="p-3 rounded-lg bg-surface-2 border border-border text-xs font-mono whitespace-pre-wrap"
            >
              {b.text}
            </pre>
          )
        }
        if (b.kind === "table") {
          return (
            // Proposal tables run wide (the GP stage ladder is 5 columns), so
            // the table scrolls inside its own box rather than forcing the
            // whole card to scroll.
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {b.head.map((cell, j) => (
                      <th
                        key={j}
                        className="border border-border bg-surface-2 px-2 py-1.5 text-left font-semibold text-foreground"
                      >
                        {inline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className="border border-border px-2 py-1.5 align-top text-foreground/90"
                        >
                          {inline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (b.kind === "ul") {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {b.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          )
        }
        if (b.kind === "ol") {
          return (
            <ol key={i} className="list-decimal pl-5 space-y-1">
              {b.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ol>
          )
        }
        if (b.kind === "h1") {
          return (
            <h2 key={i} className="text-lg font-semibold text-foreground pt-3">
              {inline(b.text)}
            </h2>
          )
        }
        if (b.kind === "h2") {
          return (
            <h3 key={i} className="text-base font-semibold text-foreground pt-3">
              {inline(b.text)}
            </h3>
          )
        }
        if (b.kind === "h3") {
          return (
            <h4 key={i} className="text-sm font-semibold text-foreground pt-2">
              {inline(b.text)}
            </h4>
          )
        }
        const nodes = parseInline(b.text)
        const rendered = renderNodes(nodes, ctx)
        // A paragraph holding an image renders as a <div>: the image is a
        // block-level <figure>, which isn't allowed inside <p>.
        return nodes.some((n) => n.kind === "image") ? (
          <div key={i} className="text-foreground/90 space-y-3">
            {rendered}
          </div>
        ) : (
          <p key={i} className="text-foreground/90">
            {rendered}
          </p>
        )
      })}
    </div>
  )
}

type Ctx = {
  media: readonly ProposalMedia[]
  onOpenImage?: (m: ProposalMedia) => void
  moderation: Readonly<Record<string, ModerationInfo>>
  revealed?: ReadonlySet<string>
  onReveal?: (key: string) => void
}

const linkClass = "text-primary hover:text-purple-dim underline-offset-2 hover:underline"

function renderNodes(nodes: InlineNode[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, key) => {
    switch (n.kind) {
      case "text":
        return n.text
      case "code":
        return (
          <code key={key} className="px-1 py-0.5 rounded bg-surface-2 text-[0.9em] font-mono">
            {n.text}
          </code>
        )
      case "strong":
        return (
          <strong key={key} className="font-semibold text-foreground">
            {renderNodes(n.children, ctx)}
          </strong>
        )
      case "em":
        return (
          <em key={key} className="italic">
            {renderNodes(n.children, ctx)}
          </em>
        )
      case "link":
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {renderNodes(n.children, ctx)}
          </a>
        )
      case "autolink":
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkClass} break-all`}
          >
            {n.href}
          </a>
        )
      case "address":
        return <AddressChip key={key} address={n.address} />
      case "image": {
        const m = findProposalImage(ctx.media, n.target)
        if (m) {
          const info = ctx.moderation[m.key]
          if (isWithheld(info)) return <WithheldMedia key={key} info={info!} className="py-6" />
          return (
            <InlineImage
              key={key}
              media={m}
              alt={n.alt}
              onOpen={ctx.onOpenImage}
              covered={info?.state === "blurred" && !ctx.revealed?.has(m.key)}
              onReveal={() => ctx.onReveal?.(m.key)}
            />
          )
        }
        // Not one of this proposal's files: never load it, show a link.
        const label = n.alt || n.target
        return isSafeUrl(n.target) ? (
          <a
            key={key}
            href={n.target}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={linkClass}
          >
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        )
      }
    }
  })
}

function InlineImage({
  media,
  alt,
  onOpen,
  covered,
  onReveal,
}: {
  media: ProposalMedia
  alt: string
  onOpen?: (m: ProposalMedia) => void
  covered: boolean
  onReveal: () => void
}) {
  const img = (
    <img
      src={media.src}
      alt={alt || media.name}
      loading="lazy"
      className="block w-full max-h-[560px] object-contain rounded-xl border border-border bg-surface-1"
    />
  )
  return (
    <figure className="space-y-1.5">
      <div className="relative overflow-hidden rounded-xl">
        {onOpen && !covered ? (
          <button type="button" onClick={() => onOpen(media)} className="block w-full cursor-zoom-in">
            {img}
          </button>
        ) : (
          img
        )}
        {covered && <SensitiveCover onReveal={onReveal} />}
      </div>
      {alt && <figcaption className="text-center text-xs text-muted-foreground">{alt}</figcaption>}
    </figure>
  )
}

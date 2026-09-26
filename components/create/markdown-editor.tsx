"use client"

import { useImperativeHandle, useRef, useState, type Ref } from "react"
import { MarkdownView } from "@/components/governance/markdown-view"
import type { ProposalMedia } from "@/lib/governance/proposal-media"
import { cn } from "@/lib/utils"

export type MarkdownEditorHandle = {
  /**
   * Insert a snippet at the cursor (or the end). `block` snippets such as
   * images get a blank line before and after so they form their own
   * paragraph.
   */
  insert: (snippet: string, opts?: { block?: boolean }) => void
}

type Props = {
  label: string
  required?: boolean
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  maxLength: number
  hint?: string
  error?: string | null
  disabled?: boolean
  /** The proposal's own files, so the preview shows its images. */
  media: readonly ProposalMedia[]
  ref?: Ref<MarkdownEditorHandle>
}

const FORMATTING: { syntax: string; result: string }[] = [
  { syntax: "## Heading", result: "Section heading (#, ## or ###)" },
  { syntax: "**bold**  *italic*", result: "Bold and italic text" },
  { syntax: "- item   1. item", result: "Bullet and numbered lists" },
  { syntax: "[label](https://…)", result: "Link" },
  { syntax: "`code`", result: "Inline code" },
  { syntax: "``` … ```", result: "Code block (lines between the fences)" },
  { syntax: "| a | b |\n|---|---|", result: "Table (header row, then a --- row)" },
  { syntax: "![caption](file)", result: "Image - only files attached to this proposal" },
]

/**
 * Proposal text editor with Write / Preview tabs (tabs rather than a split
 * view: most proposers are on phones). The preview is the same renderer
 * as the proposal page.
 */
export function MarkdownEditor({
  label,
  required,
  value,
  onChange,
  placeholder,
  rows = 12,
  maxLength,
  hint,
  error,
  disabled,
  media,
  ref,
}: Props) {
  const [tab, setTab] = useState<"write" | "preview">("write")
  const [helpOpen, setHelpOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Last cursor position, kept across blur so "Insert into text" below the
  // editor lands where the proposer was typing.
  const cursor = useRef<number | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      insert(snippet, opts) {
        const at = Math.min(cursor.current ?? value.length, value.length)
        let before = value.slice(0, at)
        let after = value.slice(at)
        if (opts?.block) {
          if (before && !before.endsWith("\n\n")) before += before.endsWith("\n") ? "\n" : "\n\n"
          if (after && !after.startsWith("\n\n"))
            after = (after.startsWith("\n") ? "\n" : "\n\n") + after
        } else if (before && !/\s$/.test(before)) {
          before += " "
        }
        const next = (before + snippet + after).slice(0, maxLength)
        const caret = Math.min(before.length + snippet.length, next.length)
        onChange(next)
        cursor.current = caret
        setTab("write")
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (!el) return
          el.focus()
          el.setSelectionRange(caret, caret)
        })
      },
    }),
    [value, onChange, maxLength],
  )

  const rememberCursor = () => {
    const el = textareaRef.current
    if (el) cursor.current = el.selectionStart
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-red-400"> *</span>}
        </label>
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-border bg-surface-1 p-0.5"
        >
          {(["write", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                tab === t
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground border border-transparent",
              )}
            >
              {t === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      {tab === "write" ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            cursor.current = e.target.selectionStart
          }}
          onSelect={rememberCursor}
          onBlur={rememberCursor}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          spellCheck
          className={cn(
            "w-full px-4 py-3 rounded-xl bg-surface-1 border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 transition-all disabled:opacity-50 font-mono resize-y",
            error
              ? "border-destructive/60 focus:border-destructive/80 focus:ring-destructive/20"
              : "border-border focus:border-primary/50 focus:ring-primary/20",
          )}
        />
      ) : (
        <div
          className="min-h-[12rem] rounded-xl border border-border bg-card px-4 py-3"
          aria-label="Preview"
        >
          {value.trim() ? (
            <MarkdownView source={value} media={media} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {error && <p className="text-[11px] text-destructive leading-snug">{error}</p>}
        </div>
        <button
          type="button"
          onClick={() => setHelpOpen((o) => !o)}
          aria-expanded={helpOpen}
          className="flex-shrink-0 text-xs text-primary hover:text-purple-dim"
        >
          Formatting help
        </button>
      </div>

      {helpOpen && (
        <div className="rounded-xl border border-border bg-surface-1 p-3 space-y-2">
          <table className="w-full text-xs">
            <tbody>
              {FORMATTING.map((f) => (
                <tr key={f.syntax} className="align-top">
                  <td className="py-1 pr-3 font-mono text-foreground whitespace-pre">{f.syntax}</td>
                  <td className="py-1 text-muted-foreground">{f.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Use &quot;Insert into text&quot; on an attachment to place it. Links to images elsewhere
            stay links. Pasted addresses become compact chips; inside `code` they stay in full.
          </p>
        </div>
      )}
    </div>
  )
}

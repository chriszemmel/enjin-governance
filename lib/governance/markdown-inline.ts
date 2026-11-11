/**
 * Inline half of the proposal markdown subset: turns one line of block text
 * into a small tree the renderer maps onto React elements.
 *
 * Supported: `code`, [label](url), <url>, ![alt](target), **bold**,
 * *italic*, and bare SS58 addresses (checksum-validated) which the
 * renderer shows as compact chips. Pure and dependency-light so it can be
 * unit tested; nothing here produces HTML strings.
 */

import { isValidSs58 } from "@/lib/chain/ss58"

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: InlineNode[] }
  | { kind: "autolink"; href: string }
  | { kind: "image"; alt: string; target: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "em"; children: InlineNode[] }
  | { kind: "address"; address: string }

/** Links may only be http(s) or same-site paths - no javascript: etc. */
export function isSafeUrl(url: string): boolean {
  // Browsers read "/\host" (and tab / newline tricks) as "//host".
  if (url.includes("\\") || /[\u0000-\u001f\u007f]/.test(url)) return false
  return /^https?:\/\//i.test(url) || (url.startsWith("/") && !url.startsWith("//"))
}

const BASE58 = "1-9A-HJ-NP-Za-km-z"
// A 32-byte account with a 1- or 2-byte SS58 prefix encodes to 46-50 chars.
const ADDRESS_RE = new RegExp(`(?<![${BASE58}])[${BASE58}]{46,50}(?![${BASE58}])`, "g")

/** Split plain text into text and address nodes. */
function splitAddresses(text: string, out: InlineNode[]) {
  let last = 0
  for (const m of text.matchAll(ADDRESS_RE)) {
    const candidate = m[0]
    if (!isValidSs58(candidate)) continue
    const at = m.index ?? 0
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) })
    out.push({ kind: "address", address: candidate })
    last = at + candidate.length
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) })
}

type Options = {
  /**
   * Inside a link label: no chips or images (a button or image inside an
   * <a> is invalid markup and would swallow the link's click).
   */
  inLink?: boolean
}

export function parseInline(text: string, opts: Options = {}): InlineNode[] {
  const out: InlineNode[] = []
  let buf = ""
  let i = 0
  const flush = () => {
    if (!buf) return
    if (opts.inLink) out.push({ kind: "text", text: buf })
    else splitAddresses(buf, out)
    buf = ""
  }

  /** `[label](target)` starting at `from` (the `[`), or null. */
  const bracketTarget = (from: number) => {
    const closeBracket = text.indexOf("]", from + 1)
    if (closeBracket <= from || text[closeBracket + 1] !== "(") return null
    const closeParen = text.indexOf(")", closeBracket + 2)
    if (closeParen <= closeBracket + 1) return null
    return {
      label: text.slice(from + 1, closeBracket),
      target: text.slice(closeBracket + 2, closeParen).trim(),
      end: closeParen + 1,
    }
  }

  while (i < text.length) {
    const c = text[i]!

    if (c === "`") {
      const end = text.indexOf("`", i + 1)
      if (end > i) {
        flush()
        out.push({ kind: "code", text: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (c === "!" && text[i + 1] === "[" && !opts.inLink) {
      const t = bracketTarget(i + 1)
      if (t && t.target) {
        flush()
        out.push({ kind: "image", alt: t.label, target: t.target })
        i = t.end
        continue
      }
    }

    if (c === "[") {
      const t = bracketTarget(i)
      if (t && isSafeUrl(t.target)) {
        flush()
        out.push({ kind: "link", href: t.target, children: parseInline(t.label, { inLink: true }) })
        i = t.end
        continue
      }
    }

    if (c === "<") {
      const end = text.indexOf(">", i + 1)
      if (end > i) {
        const inner = text.slice(i + 1, end)
        if (isSafeUrl(inner)) {
          flush()
          out.push({ kind: "autolink", href: inner })
          i = end + 1
          continue
        }
      }
    }

    if (c === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2)
      if (end > i + 1) {
        flush()
        out.push({ kind: "strong", children: parseInline(text.slice(i + 2, end), opts) })
        i = end + 2
        continue
      }
    }

    if (c === "*") {
      const end = text.indexOf("*", i + 1)
      if (end > i) {
        flush()
        out.push({ kind: "em", children: parseInline(text.slice(i + 1, end), opts) })
        i = end + 1
        continue
      }
    }

    buf += c
    i++
  }
  flush()
  return out
}

/**
 * Block parser for the trimmed-down markdown subset used to render proposal
 * bodies. Deliberately not a full markdown implementation - it avoids
 * pulling a parser into the bundle for what are usually a few hundred lines
 * of prose.
 *
 * Pure and dependency-free so it can be unit tested; the rendering half
 * lives in components/governance/proposal-metadata-header.tsx and turns
 * these blocks into React children (never dangerouslySetInnerHTML), so user
 * content can't inject markup.
 *
 * Supported: ATX headings (#, ##, ###), fenced code, unordered and ordered
 * lists, GFM pipe tables, paragraphs. Inline marks are handled separately by
 * the renderer.
 */

type MarkdownBlock =
  | { kind: "code"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "para"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }

/** `| a | b |` → ["a", "b"], tolerating missing outer pipes. */
export function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (s.endsWith("|")) s = s.slice(0, -1)
  return s.split("|").map((c) => c.trim())
}

/** The `|---|:--:|` delimiter row that makes the line above it a header. */
export function isTableSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = source.split(/\r?\n/)
  let paraBuf: string[] = []
  let ulBuf: string[] = []
  let olBuf: string[] = []
  let codeBuf: string[] = []
  let tableBuf: string[] = []
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
  /**
   * A run of pipe-led lines is only a table if the second line is a
   * delimiter row. Anything else falls back to prose, so stray pipes in body
   * text keep rendering the way they always did rather than vanishing.
   */
  const flushTable = () => {
    if (!tableBuf.length) return
    const buffered = tableBuf
    tableBuf = []
    if (buffered.length >= 2 && isTableSeparatorRow(buffered[1]!)) {
      blocks.push({
        kind: "table",
        head: splitTableRow(buffered[0]!),
        rows: buffered.slice(2).map(splitTableRow),
      })
      return
    }
    for (const l of buffered) paraBuf.push(l)
    flushPara()
  }
  // flushTable first: its prose fallback appends to paraBuf, so the
  // paragraph flush has to run after it.
  const flushAll = () => {
    flushTable()
    flushPara()
    flushUl()
    flushOl()
  }

  for (const line of lines) {
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

    if (/^\s*\|/.test(line)) {
      flushPara()
      flushUl()
      flushOl()
      tableBuf.push(line)
      continue
    }
    flushTable()

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

  return blocks
}

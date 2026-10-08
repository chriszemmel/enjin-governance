/**
 * What a referendum's share image says, worked out without rendering: how
 * big the title can be and what the call does in a few words. Pure, so the
 * layout rules are unit tested.
 *
 * The image is static per referendum (it's cached on the CDN and never
 * shows status, tally or time), so everything here is stable for a given
 * referendum: its title, number, track and call.
 */

/** Width of the title column and height of its box, in px (1200x630 card). */
const TITLE_WIDTH = 1088
const TITLE_BOX = 330
/** Inter 600 at -0.03em tracking: roughly this many em per character. */
const CHAR_EM = 0.47
const LINE_HEIGHT = 1.08
/** Lines rarely fill the full width; leave room for ragged wrapping. */
const FILL = 0.88

/** The amount below the title is 56px: the title never drops under this. */
export const TITLE_FLOOR = 60
const TITLE_MAX = 104
const MULTI_LINE_MAX = 84

type TitleFit = { text: string; size: number; lines: number }

/**
 * Size a title to the card. One line while it fits at the floor or above
 * (scaled up to 104px for short titles); otherwise the largest size from
 * 84px down to the floor at which it fits the box in up to four lines;
 * otherwise the floor, cut at a word boundary with "…". The fixed parts of
 * the card (number, track, amount) never change size.
 */
export function fitTitle(raw: string): TitleFit {
  const title = raw.replace(/\s+/g, " ").trim()
  const n = Math.max(title.length, 1)
  const oneLine = Math.min(TITLE_MAX, Math.floor(TITLE_WIDTH / (n * 0.52)))
  if (oneLine >= TITLE_FLOOR) return { text: title, size: oneLine, lines: 1 }

  const linesAt = (size: number) => Math.ceil((n * size * CHAR_EM) / (TITLE_WIDTH * FILL))
  for (let size = MULTI_LINE_MAX; size >= TITLE_FLOOR; size -= 2) {
    const lines = linesAt(size)
    if (lines <= 4 && lines * size * LINE_HEIGHT <= TITLE_BOX - 40) return { text: title, size, lines }
  }

  const lines = Math.min(4, Math.floor((TITLE_BOX - 40) / (TITLE_FLOOR * LINE_HEIGHT)))
  const room = Math.floor((lines * TITLE_WIDTH * FILL) / (TITLE_FLOOR * CHAR_EM))
  let cut = title.slice(0, room)
  const space = cut.lastIndexOf(" ")
  if (space > room * 0.6) cut = cut.slice(0, space)
  // No dangling punctuation or filler word before the ellipsis.
  const dangling = /[\s,.;:–—-]+$|\s+(a|an|the|and|or|of|for|to|in|on|with)$/i
  while (dangling.test(cut)) cut = cut.replace(dangling, "")
  return { text: `${cut}…`, size: TITLE_FLOOR, lines }
}

/** The second line of the card: an amount, or what the call does. */
export type CardFact =
  | { kind: "amount"; text: string }
  | { kind: "action"; label: string; detail: string | null }

type Call = { section: string; method: string; args: Record<string, unknown> }

/**
 * A readable label for a call that isn't a local treasury spend, with the
 * raw call as small print. Unknown calls show as `pallet.method`.
 */
export function actionFact(call: Call): CardFact {
  const section = call.section.toLowerCase()
  const method = call.method.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  const raw = `${section}.${method}`
  const arg = (...names: string[]) => names.map((name) => call.args[name]).find((v) => v != null)

  if (section === "system" && /^authorizeUpgrade/.test(method)) {
    const hash = arg("codeHash", "code_hash")
    return {
      kind: "action",
      label: "Runtime upgrade",
      detail: typeof hash === "string" ? `${raw} · ${hash.slice(0, 10)}…` : raw,
    }
  }
  if (section === "system" && /^setCode/.test(method)) {
    return { kind: "action", label: "Runtime upgrade", detail: raw }
  }
  if (section === "utility" && /^(batch|batchAll|forceBatch)$/.test(method)) {
    const calls = arg("calls")
    const count = Array.isArray(calls) ? calls.length : null
    return {
      kind: "action",
      label: count != null ? `Batch · ${count} ${count === 1 ? "call" : "calls"}` : "Batch",
      detail: raw,
    }
  }
  if (section === "referenda" && (method === "cancel" || method === "kill")) {
    const index = arg("index")
    const verb = method === "cancel" ? "Cancel" : "Kill"
    return {
      kind: "action",
      label: index != null ? `${verb} referendum #${String(index).replace(/,/g, "")}` : `${verb} referendum`,
      detail: raw,
    }
  }
  if (section === "whitelist" && /^dispatchWhitelistedCall/.test(method)) {
    return { kind: "action", label: "Whitelisted call", detail: raw }
  }
  if (section === "treasury" && method === "spend") {
    return { kind: "action", label: "Treasury spend", detail: raw }
  }
  return { kind: "action", label: raw, detail: null }
}

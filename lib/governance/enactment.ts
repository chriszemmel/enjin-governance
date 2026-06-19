/**
 * Enactment-moment selection for referenda.submit.
 *
 * A proposal's enactment is `After(n)` (n blocks after it passes, runtime-
 * clamped to the track's minEnactmentPeriod) or `At(block)` (a fixed block
 * height). The wizard hardcoded `After 0`; this module models the user's
 * choice and resolves/validates it.
 */

export type EnactmentChoice =
  | { mode: "standard" }
  | { mode: "afterDelay"; blocks: number }
  | { mode: "atBlock"; block: number }

export const DEFAULT_ENACTMENT: EnactmentChoice = { mode: "standard" }

/** Resolve a choice to the `{ type, block }` shape buildSubmit expects. */
export function resolveEnactment(
  choice: EnactmentChoice,
): { type: "At" | "After"; block: number } {
  switch (choice.mode) {
    case "standard":
      return { type: "After", block: 0 }
    case "afterDelay":
      return { type: "After", block: Math.max(0, Math.floor(choice.blocks)) }
    case "atBlock":
      return { type: "At", block: Math.max(0, Math.floor(choice.block)) }
  }
}

/**
 * Validate a choice. Returns a human-readable error string, or null if valid.
 * `currentBlock` (when known) lets us reject an `At` height in the past;
 * `minEnactment` (track.minEnactmentPeriod) drives an informational floor.
 */
export function validateEnactment(
  choice: EnactmentChoice,
  opts: { currentBlock?: number | null; minEnactment?: number | null } = {},
): string | null {
  if (choice.mode === "afterDelay") {
    if (!Number.isInteger(choice.blocks) || choice.blocks < 0) {
      return "Delay must be a non-negative whole number of blocks."
    }
    return null
  }
  if (choice.mode === "atBlock") {
    if (!Number.isInteger(choice.block) || choice.block <= 0) {
      return "Enter a positive block height."
    }
    const { currentBlock, minEnactment } = opts
    if (currentBlock != null) {
      const floor = currentBlock + (minEnactment ?? 0)
      if (choice.block <= currentBlock) {
        return "Block height is in the past."
      }
      if (choice.block < floor) {
        return `Too soon - the track needs at least ${minEnactment} blocks after passing (≥ block ${floor}).`
      }
    }
    return null
  }
  return null
}

/** Short human label for a resolved choice (for review/confirm screens). */
export function enactmentLabel(choice: EnactmentChoice): string {
  switch (choice.mode) {
    case "standard":
      return "As soon as possible after passing"
    case "afterDelay":
      return `${choice.blocks} block(s) after passing`
    case "atBlock":
      return `At block #${choice.block}`
  }
}

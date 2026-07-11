/**
 * UI-side display helpers for governance types. Pure functions - safe to
 * import from server or client components.
 */

import type { ReferendumStatusType } from "./types"

/** Human-friendly label for a referendum status. */
export function statusLabel(type: ReferendumStatusType): string {
  switch (type) {
    case "Ongoing":
      return "Active"
    case "Approved":
      return "Approved"
    case "Rejected":
      return "Rejected"
    case "Cancelled":
      return "Cancelled"
    case "TimedOut":
      return "Timed out"
    case "Killed":
      return "Killed"
  }
}

/**
 * Format a runtime-emitted track name into human-readable display text.
 * The referenda pallet serialises track names in snake_case
 * (`small_tipper`, `referendum_canceller`) - render them as proper
 * spaced Title Case ("Small Tipper", "Referendum Canceller").
 *
 * Also tolerates PascalCase inputs (`SmallTipper`) for the rare path
 * where we already have the origin variant name from a decoded
 * extrinsic rather than the consts table.
 */
export function formatTrackName(name: string): string {
  if (!name) return ""
  if (name.includes(" ")) return name
  if (name.includes("_")) {
    return name
      .split("_")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
  }
  // PascalCase → split on uppercase boundaries
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * Tailwind class string for the status chip's state dot. The chip itself
 * is neutral ink on `surface-1` for every status - state lives in this
 * dot alone, keeping green/red reserved for vote outcomes.
 */
export function statusDotClasses(type: ReferendumStatusType): string {
  switch (type) {
    case "Ongoing":
      return "bg-primary animate-pulse"
    case "Approved":
      return "bg-green-500"
    case "Rejected":
    case "Killed":
      return "bg-red-500"
    case "Cancelled":
    case "TimedOut":
      return "bg-muted-foreground"
  }
}

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

/** Tailwind class string for the per-status pill badge. */
export function statusColorClasses(type: ReferendumStatusType): string {
  switch (type) {
    case "Ongoing":
      return "text-blue-400 bg-blue-400/10 border-blue-400/20"
    case "Approved":
      return "text-green-400 bg-green-400/10 border-green-400/20"
    case "Rejected":
      return "text-red-400 bg-red-400/10 border-red-400/20"
    case "Cancelled":
      return "text-zinc-400 bg-zinc-400/10 border-zinc-400/20"
    case "TimedOut":
      return "text-amber-400 bg-amber-400/10 border-amber-400/20"
    case "Killed":
      return "text-red-500 bg-red-500/10 border-red-500/20"
  }
}

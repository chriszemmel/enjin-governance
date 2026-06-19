/**
 * Chain-aware formatters.
 *
 * - planck<->whole-token conversion (BigInt-safe, never floats).
 * - block-count → human duration assuming 6s block time (standard for
 *   Polkadot SDK relay chains; override if a future chain differs).
 *
 * UI-only formatters (compact number, percent, date) live in lib/format.ts.
 * Chain-display formatters live here because they depend on chain metadata
 * (decimals, ticker, block time).
 */

import { type ChainConfig } from "./chains"

const TEN = 10n

/** Default block time for Polkadot SDK chains. Override per-chain if needed. */
const DEFAULT_BLOCK_TIME_MS = 6_000

/**
 * Convert a chain block number into an approximate Date by anchoring to the
 * current block. Past blocks → past dates; future blocks → predicted dates.
 */
export function blockToDate(
  block: number,
  currentBlock: number,
  now: Date = new Date(),
  blockTimeMs = DEFAULT_BLOCK_TIME_MS,
): Date {
  return new Date(now.getTime() - (currentBlock - block) * blockTimeMs)
}

/**
 * Format a block number as "3 days ago" / "in 2 hours" relative to `now`.
 * Falls back to "-" if `currentBlock` is null (still loading).
 */
export function formatRelativeBlockTime(
  block: number,
  currentBlock: number | null | undefined,
  now: Date = new Date(),
  blockTimeMs = DEFAULT_BLOCK_TIME_MS,
): string {
  if (currentBlock == null) return "-"
  const date = blockToDate(block, currentBlock, now, blockTimeMs)
  const diffSec = Math.round((date.getTime() - now.getTime()) / 1000)
  return formatRelativeSeconds(diffSec)
}

/** "3 days ago" / "in 2 hours" / "just now". */
function formatRelativeSeconds(diffSec: number): string {
  const abs = Math.abs(diffSec)
  if (abs < 30) return "just now"
  const past = diffSec < 0

  const units: Array<[number, string]> = [
    [60, "second"],
    [3_600, "minute"],
    [86_400, "hour"],
    [604_800, "day"],
    [2_629_800, "week"],
    [31_557_600, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ]

  let value = abs
  let unit = "second"
  let prevDivisor = 1
  for (const [divisor, name] of units) {
    if (abs < divisor) {
      value = Math.round(abs / prevDivisor)
      unit = name
      break
    }
    prevDivisor = divisor
  }

  const plural = value === 1 ? unit : `${unit}s`
  return past ? `${value} ${plural} ago` : `in ${value} ${plural}`
}

/** Format an absolute timestamp: "2025-05-17 13:24 UTC". */
export function formatAbsoluteTime(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  const hh = String(date.getUTCHours()).padStart(2, "0")
  const mi = String(date.getUTCMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`
}

function pow10(decimals: number): bigint {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(`decimals must be a non-negative integer, got ${decimals}`)
  }
  let result = 1n
  for (let i = 0; i < decimals; i++) result *= TEN
  return result
}

/**
 * Convert planck (smallest unit) to a display string with full precision.
 * No rounding, no truncation. Use formatTokenAmount for UI display.
 *
 * Example: planckToString(1_500_000_000_000_000_000n, 18) → "1.5"
 */
export function planckToString(planck: bigint, decimals: number): string {
  if (decimals === 0) return planck.toString()
  const negative = planck < 0n
  const abs = negative ? -planck : planck
  const divisor = pow10(decimals)
  const whole = abs / divisor
  const fraction = abs % divisor

  if (fraction === 0n) return (negative ? "-" : "") + whole.toString()

  let fracStr = fraction.toString().padStart(decimals, "0")
  // strip trailing zeros for readability - never strip a leading zero
  fracStr = fracStr.replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole.toString()}.${fracStr}`
}

/**
 * Convert a planck amount to a display string suitable for UI rendering.
 * Caps the displayed fractional digits at `maxFractionDigits` (rounding
 * is truncation toward zero - never round up an amount the user might
 * confuse with what they actually own).
 */
export function formatTokenAmount(
  planck: bigint,
  chain: ChainConfig,
  options: { maxFractionDigits?: number; withTicker?: boolean } = {},
): string {
  const { maxFractionDigits = 4, withTicker = true } = options
  const full = planckToString(planck, chain.decimals)
  const [whole, fraction] = full.split(".") as [string, string | undefined]

  const wholeWithSep = BigInt(whole.replace(/^-/, "")).toLocaleString("en-US")
  const signed = whole.startsWith("-") ? `-${wholeWithSep}` : wholeWithSep

  let display: string
  if (!fraction || maxFractionDigits === 0) {
    display = signed
  } else {
    const truncated = fraction.slice(0, maxFractionDigits).replace(/0+$/, "")
    display = truncated.length > 0 ? `${signed}.${truncated}` : signed
  }

  return withTicker ? `${display} ${chain.ticker}` : display
}

/**
 * Compact display: "1.23M ENJ", "412.5K ENJ", "85 ENJ".
 * For lists where horizontal space is tight.
 */
export function formatTokenAmountCompact(
  planck: bigint,
  chain: ChainConfig,
  options: { withTicker?: boolean } = {},
): string {
  const { withTicker = true } = options
  const wholeStr = planckToString(planck, chain.decimals).split(".")[0] ?? "0"
  const whole = Number(wholeStr)
  const suffix = withTicker ? ` ${chain.ticker}` : ""

  if (Math.abs(whole) >= 1_000_000_000) {
    return `${(whole / 1_000_000_000).toFixed(2)}B${suffix}`
  }
  if (Math.abs(whole) >= 1_000_000) {
    return `${(whole / 1_000_000).toFixed(2)}M${suffix}`
  }
  if (Math.abs(whole) >= 1_000) {
    return `${(whole / 1_000).toFixed(1)}K${suffix}`
  }
  return `${whole.toLocaleString("en-US")}${suffix}`
}

/**
 * Parse a user-entered whole-token string into planck. Accepts:
 *   "1", "1.5", "0.000001", "1000000"
 *
 * Throws on negative numbers, scientific notation, or anything that isn't a
 * non-negative decimal. Strips a trailing ticker like " ENJ" before parsing.
 */
export function parseTokenAmount(input: string, chain: ChainConfig): bigint {
  // Accept both `.` and `,` as the decimal separator - keyboards in
  // many locales default to comma, and there's no ambiguity with a
  // thousands grouping here because we strip those before validating.
  const cleaned = input
    .trim()
    .replace(new RegExp(`\\s*${chain.ticker}\\s*$`, "i"), "")
    .replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid amount: ${input}`)
  }
  const [whole, fraction = ""] = cleaned.split(".")
  if (fraction.length > chain.decimals) {
    throw new Error(`Too many decimal places (max ${chain.decimals}): ${input}`)
  }
  const paddedFraction = fraction.padEnd(chain.decimals, "0")
  return BigInt(whole ?? "0") * pow10(chain.decimals) + BigInt(paddedFraction || "0")
}

export function blocksToSeconds(blocks: number, blockTimeMs = DEFAULT_BLOCK_TIME_MS): number {
  return Math.round((blocks * blockTimeMs) / 1_000)
}

/**
 * Human-friendly duration for a block count.
 *   144_000 blocks (~10 days @ 6s) → "10d"
 *   3_600   blocks (~6h)            → "6h"
 *   600     blocks (~1h)            → "1h"
 */
export function formatBlockDuration(blocks: number, blockTimeMs = DEFAULT_BLOCK_TIME_MS): string {
  const seconds = blocksToSeconds(blocks, blockTimeMs)
  if (seconds <= 0) return "-"

  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)

  if (days >= 1) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }
  if (hours >= 1) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  if (minutes >= 1) return `${minutes}m`
  return `${seconds}s`
}

/**
 * Deterministic JSON encoding. Lives in its own file (no server-only)
 * so both client and server can reproduce the exact bytes - important
 * because the sha256 of these bytes is committed to chain inside the
 * `system.remark` envelope and must be reproducible by external indexers.
 */

/**
 * JSON.stringify with object keys sorted lexicographically at every level.
 * Arrays preserve order. Output uses `JSON.stringify`'s default separators.
 */
export function stringifyStable(value: unknown): string {
  return JSON.stringify(value, replacer)
}

function replacer(_key: string, val: unknown): unknown {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) sorted[k] = obj[k]
    return sorted
  }
  return val
}

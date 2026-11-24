/**
 * Narrow an indexed read in a test (`rows[0]`, `map.get(k)`) to its value,
 * failing the test with a readable message when it is missing. This is the
 * runtime-checked alternative to `rows[0]!` under noUncheckedIndexedAccess:
 * a missing row fails loudly here instead of as a TypeError three lines on.
 */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${what} to be present, got ${String(value)}`)
  }
  return value
}

/**
 * Shared links name a referendum's chain with `/proposals/<n>?network=<id>`.
 * Layouts can't read the query string, so proxy.ts copies the value into
 * this request header for the proposal layout (title, canonical URL). The
 * layout checks it against the enabled chains; anything else means the
 * default network. Kept free of other imports so the proxy stays small.
 */
export const NETWORK_HINT_HEADER = "x-proposal-network"

const NETWORK_ID = /^[a-z][a-z-]{0,31}$/

/** The `?network=` value if it looks like a chain id, else null. */
export function networkHint(value: string | null): string | null {
  return value && NETWORK_ID.test(value) ? value : null
}

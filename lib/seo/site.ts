/**
 * Site-wide facts the SEO routes and page metadata share: the public origin,
 * whether the password gate is on, and how referendum URLs are written.
 */

import { CHAINS, type ChainConfig, type ChainId } from "@/lib/chain/chains"
import { env } from "@/lib/env"

/** The public origin from NEXT_PUBLIC_APP_URL, without a trailing slash. */
export function siteUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")
}

/** Absolute URL of a path on this site. */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path}`
}

/**
 * The site-wide password gate (proxy.ts) is on. Read at call time, like the
 * proxy does, so robots.txt follows the running configuration.
 */
export function isSiteGated(): boolean {
  return process.env.SITE_PASSWORD_STATUS === "ON"
}

/** The network a `/proposals/<n>` link without `?network=` refers to. */
export function defaultChain(): ChainConfig {
  return CHAINS[env.NEXT_PUBLIC_DEFAULT_NETWORK]
}

/** The enabled chain a `?network=` value names, or the default network. */
export function chainFromHint(hint: string | null): ChainConfig {
  if (hint && Object.hasOwn(CHAINS, hint)) {
    const chain = CHAINS[hint as ChainId]
    if (chain.enabled) return chain
  }
  return defaultChain()
}

/**
 * Referendum index from the URL segment, read the way the page reads it
 * (`Number(...)`), so "05" and "5" are the same page. Null when the page
 * would show "not a valid referendum index".
 */
export function parseReferendumIndex(raw: string): number | null {
  if (raw.trim() === "") return null
  const index = Number(raw)
  return Number.isSafeInteger(index) && index >= 0 ? index : null
}

/**
 * Canonical path of a referendum page. The default network's pages have no
 * query string; another network's keep their `?network=`, since the same
 * index is a different referendum there.
 */
export function proposalPath(index: number, chain: ChainConfig): string {
  return chain.id === defaultChain().id
    ? `/proposals/${index}`
    : `/proposals/${index}?network=${chain.id}`
}

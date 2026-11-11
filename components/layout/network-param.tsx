"use client"

import { useNetworkParam } from "@/lib/chain/use-network-param"

/**
 * Applies `?network=` on a page that is otherwise prerendered. Put it in
 * its own <Suspense>: only this, not the page, waits for the search params.
 */
export function NetworkParam() {
  useNetworkParam()
  return null
}

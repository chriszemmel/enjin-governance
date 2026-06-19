"use client"

import { useEffect } from "react"
import { initializeWasm } from "@/lib/chain/ss58"
import { restoreWallet } from "./store"

/**
 * Mount-once side effect:
 *   1. Initialize the @polkadot/util-crypto WASM module.
 *   2. Re-hydrate the active wallet session if one was persisted.
 *
 * Renders nothing. Mounted from Providers.
 */
export function WalletRestoreMounter() {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await initializeWasm()
        if (cancelled) return
        await restoreWallet()
      } catch {
        // Best-effort restore - failures fall back to disconnected state.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return null
}

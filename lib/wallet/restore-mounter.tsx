"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { initializeWasm } from "@/lib/chain/ss58"
import { useSignOutIfOtherAccount } from "@/lib/query/hooks/use-session"
import { onWalletConnectSessionGone } from "./connectors/walletconnect"
import { restoreWallet, walletSessionGone } from "./store"

/**
 * Mount-once side effect:
 *   1. Initialize the @polkadot/util-crypto WASM module.
 *   2. Re-hydrate the active wallet session if one was persisted.
 *   3. If the persisted account is gone from the wallet, restore falls back
 *      to the session's first account - treat that like an account switch
 *      and drop a sign-in minted for a different account.
 *   4. When the wallet ends the WalletConnect session (or it expires),
 *      show the wallet as disconnected and say so.
 *
 * Renders nothing. Mounted in the root layout, inside QueryProvider (step 3
 * reads the sign-in session).
 */
export function WalletRestoreMounter() {
  const signOutIfOtherAccount = useSignOutIfOtherAccount()
  useEffect(() => {
    return onWalletConnectSessionGone((topic, reason) => {
      const message = walletSessionGone(topic, reason)
      if (message) toast.info(message)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await initializeWasm()
        if (cancelled) return
        const switchedTo = await restoreWallet()
        if (switchedTo && !cancelled) await signOutIfOtherAccount(switchedTo)
      } catch {
        // Best-effort restore - failures fall back to disconnected state.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signOutIfOtherAccount])
  return null
}

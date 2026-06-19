"use client"

import { useCallback, useState } from "react"
import { buildSignRequestDeepLink } from "@/lib/wallet/deep-link"
import { useWallet } from "@/lib/wallet/use-wallet"

/**
 * Shared state for the "Sign with Enjin Wallet" modal that appears
 * whenever a WalletConnect-backed wallet (Enjin Wallet, generic WC) is
 * being asked to sign anything - vote, decision deposit, refund,
 * treasury proposal submission, sign-in, etc.
 *
 * The modal itself is `<SignRequestModal />`. This hook owns the
 * open/close state and the deep link the modal's "Open in Enjin Wallet"
 * button fires from a fresh user-gesture frame.
 *
 * Usage:
 *
 *   const sign = useSignFlow()
 *   const tx = useExtrinsic({
 *     ...,
 *     onStatus(s) {
 *       if (s.kind === "broadcast" || s.kind === "error") sign.close()
 *     },
 *   })
 *
 *   const onClick = () => { sign.open(); void tx.submit() }
 *
 *   <SignRequestModal
 *     open={sign.isOpen}
 *     deepLinkUrl={sign.deepLinkUrl}
 *     error={tx.status.kind === "error" ? tx.status.message : null}
 *     onClose={sign.close}
 *     onRetry={() => { tx.reset(); void tx.submit() }}
 *     title="…" subtitle="…"
 *   />
 */
export function useSignFlow() {
  const { session, connectorId } = useWallet()
  const isWalletConnect =
    connectorId === "enjin-wallet" || connectorId === "walletconnect"
  const [isOpen, setIsOpen] = useState(false)

  const deepLinkUrl = buildSignRequestDeepLink({
    peerRedirect:
      (session?.meta?.peerRedirect as string | null | undefined) ?? null,
    sessionTopic: (session?.meta?.topic as string | undefined) ?? null,
  })

  const open = useCallback(() => {
    if (isWalletConnect) setIsOpen(true)
  }, [isWalletConnect])
  const close = useCallback(() => setIsOpen(false), [])

  return { isWalletConnect, isOpen, open, close, deepLinkUrl }
}

"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { samePublicKey } from "@/lib/chain/ss58"
import { useMe, useNoncePrefetch, useSignIn } from "@/lib/query/hooks/use-session"
import { formatError } from "@/lib/utils/format-error"
import { useWallet } from "./use-wallet"

/**
 * Whether a sign-in session is this wallet's, matched by public key so any
 * network's address format counts. A session for another account doesn't:
 * the write routes only accept the signer's own address.
 */
export function isSessionFor(
  me: { address: string } | null | undefined,
  address: string | null | undefined,
): boolean {
  if (!me || !address) return false
  try {
    return samePublicKey(me.address, address)
  } catch {
    return false
  }
}

/**
 * Race `work` against a dismissal: `dismiss()` settles `result` with
 * "dismissed" at once, while `work` carries on (its late answer, or error,
 * is ignored here).
 */
export function dismissable<T>(work: Promise<T>): {
  result: Promise<T | "dismissed">
  dismiss: () => void
} {
  let dismiss = () => {}
  const dismissed = new Promise<"dismissed">((resolve) => {
    dismiss = () => resolve("dismissed")
  })
  return { result: Promise.race([work, dismissed]), dismiss }
}

/**
 * Resolve a signed-in session, prompting the wallet to sign the nonce if
 * there isn't one yet. Returns false when the user cancels or the
 * signature fails, so callers can abort the write they were about to make
 * (draft staging, media uploads, confirming a submission).
 *
 * `signInModal` feeds a <SignRequestModal /> for WalletConnect wallets,
 * where the signature has to be approved on the phone. Closing it counts
 * as cancelling: the request stays open in the wallet until it expires
 * (15 minutes), and callers that hold a lock meanwhile (the composers'
 * click guard) would otherwise stay locked that long.
 */
export function useEnsureSignedIn({ isWalletConnect }: { isWalletConnect: boolean }) {
  const { activeAddress } = useWallet()
  const meQuery = useMe()
  // Mint a nonce in the background so the prompt can fire without a
  // network hop in between.
  const prefetchedNonce = useNoncePrefetch()
  const signIn = useSignIn(prefetchedNonce)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The sign-ins waiting on the dialog; closing it settles them with false.
  const waitingRef = useRef(new Set<() => void>())

  const ensureSignedIn = useCallback(
    async (opts?: { fresh?: boolean }): Promise<boolean> => {
      // `fresh`: the server just answered 401, so the cached "signed in"
      // can't be trusted - re-check (and sign in again if needed).
      if (isSessionFor(meQuery.data, activeAddress) && !opts?.fresh) return true
      // The /api/auth/me poll can trail a fresh cookie by up to 60s - re-check
      // before forcing a signature the user may not actually need.
      try {
        const refreshed = await meQuery.refetch()
        if (isSessionFor(refreshed.data, activeAddress)) return true
      } catch {
        // fall through to the sign-in prompt
      }
      setError(null)
      if (isWalletConnect) setOpen(true)
      // A late answer from the wallet still signs in (useSignIn refreshes
      // the session); this caller just stops waiting for it.
      const attempt = dismissable(signIn.submit())
      waitingRef.current.add(attempt.dismiss)
      try {
        if ((await attempt.result) === "dismissed") return false
        setOpen(false)
        toast.success("Signed in")
        return true
      } catch (e) {
        const message = formatError(e)
        setError(message)
        if (!isWalletConnect) toast.error("Sign-in required", { description: message })
        return false
      } finally {
        waitingRef.current.delete(attempt.dismiss)
      }
    },
    [meQuery, activeAddress, isWalletConnect, signIn],
  )

  const signInModal = {
    open,
    status: error ? ({ kind: "error", message: error } as const) : ({ kind: "signing" } as const),
    onClose: () => {
      setOpen(false)
      for (const dismiss of waitingRef.current) dismiss()
      waitingRef.current.clear()
    },
    onRetry: () => {
      setError(null)
      signIn
        .submit()
        .then(() => {
          setOpen(false)
          toast.success("Signed in")
        })
        .catch((e) => setError(formatError(e)))
    },
  }

  return { ensureSignedIn, signInModal }
}

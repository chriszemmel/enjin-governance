"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { useMe, useNoncePrefetch, useSignIn } from "@/lib/query/hooks/use-session"
import { formatError } from "@/lib/utils/format-error"

/**
 * Resolve a signed-in session, prompting the wallet to sign the nonce if
 * there isn't one yet. Returns false when the user cancels or the
 * signature fails, so callers can abort the write they were about to make
 * (draft staging, media uploads, confirming a submission).
 *
 * `signInModal` feeds a <SignRequestModal /> for WalletConnect wallets,
 * where the signature has to be approved on the phone.
 */
export function useEnsureSignedIn({ isWalletConnect }: { isWalletConnect: boolean }) {
  const meQuery = useMe()
  // Mint a nonce in the background so the prompt can fire without a
  // network hop in between.
  const prefetchedNonce = useNoncePrefetch()
  const signIn = useSignIn(prefetchedNonce)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ensureSignedIn = useCallback(
    async (opts?: { fresh?: boolean }): Promise<boolean> => {
      // `fresh`: the server just answered 401, so the cached "signed in"
      // can't be trusted - re-check (and sign in again if needed).
      if (meQuery.data && !opts?.fresh) return true
      // The /api/auth/me poll can trail a fresh cookie by up to 60s - re-check
      // before forcing a signature the user may not actually need.
      try {
        const refreshed = await meQuery.refetch()
        if (refreshed.data) return true
      } catch {
        // fall through to the sign-in prompt
      }
      setError(null)
      if (isWalletConnect) setOpen(true)
      try {
        await signIn.submit()
        setOpen(false)
        toast.success("Signed in")
        return true
      } catch (e) {
        const message = formatError(e)
        setError(message)
        if (!isWalletConnect) toast.error("Sign-in required", { description: message })
        return false
      }
    },
    [meQuery, isWalletConnect, signIn],
  )

  const signInModal = {
    open,
    status: error ? ({ kind: "error", message: error } as const) : ({ kind: "signing" } as const),
    onClose: () => setOpen(false),
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

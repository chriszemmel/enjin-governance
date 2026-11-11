"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import type { Signer } from "@polkadot/api/types"
import { stringToHex } from "@polkadot/util"
import { encodeForChain, samePublicKey } from "@/lib/chain/ss58"
import { getActiveChain } from "@/lib/chain/use-chain"
import { formatError } from "@/lib/utils/format-error"
import { getConnectorMeta } from "@/lib/wallet/connector-registry"
import { useWallet } from "@/lib/wallet/use-wallet"

type IssuedNonce = { nonce: string; message: string; address: string }

async function requestNonce(address: string): Promise<IssuedNonce> {
  const res = await fetch("/api/auth/nonce", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  })
  const json = (await res.json()) as
    | { ok: true; nonce: string; message: string }
    | { ok: false; error: string }
  if (!("ok" in json) || !json.ok) {
    throw new Error("Could not request a nonce.")
  }
  return { nonce: json.nonce, message: json.message, address }
}

/**
 * Pre-fetch a fresh nonce as soon as the user lands on an account-aware
 * page, so clicking Sign-in goes straight to signRaw without a round-trip
 * to /api/auth/nonce first - the request reaches the wallet sooner. (On
 * mobile the wallet is opened by the SignRequestModal's "Open in <wallet>"
 * link, which the user taps; nothing here fires a deep link.)
 *
 * Refresh well inside the server-side TTL (30 min - NONCE_TTL_MS in
 * lib/auth/siwe.ts) so the cached nonce is always live. We don't poll
 * faster - each request inserts a fresh row into the `auth_nonces` table,
 * so over-refreshing just leaves more rows for the expiry sweep.
 */
export function useNoncePrefetch(): IssuedNonce | undefined {
  const { activeAddress, status } = useWallet()
  const chain = getActiveChain()
  const signingAddress = (() => {
    if (!activeAddress) return null
    try {
      return encodeForChain(activeAddress, chain.id)
    } catch {
      return activeAddress
    }
  })()
  const q = useQuery<IssuedNonce>({
    queryKey: ["auth-nonce", signingAddress, chain.id],
    queryFn: () => requestNonce(signingAddress!),
    enabled: status === "connected" && !!signingAddress,
    // Refresh aggressively so the cached nonce is always fresh when
    // the user clicks Sign-in. refetchInterval pauses while the tab
    // is backgrounded (which is exactly when the user is in their
    // mobile wallet) - refetchOnWindowFocus catches that case by
    // re-issuing the nonce the moment the user returns to Safari.
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  return q.data
}

type Me = {
  id: string
  address: string
  handle: string | null
  display_name: string | null
  bio: string | null
  avatar_url: string | null
}

const ME_KEY = ["me"] as const
/** The moderation role belongs to the session: it changes when that does. */
const MODERATION_KEY = ["moderation"] as const

async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { ok: true; user: Me }
  return json.user
}

/**
 * Current sign-in state. Returns the connected user when the session
 * cookie is valid, otherwise null. Polls every 60s so a server-side
 * logout (cookie expiry, manual DB delete) propagates.
 */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

// Module-level lock to drop re-entrant sign-in calls. iOS Safari can
// double-fire click handlers when the wake's deep link triggers an
// "Open in Enjin Wallet?" prompt - without this guard we send two
// concurrent signRaw requests, each with its own nonce, and the
// wallet shows two stacked sign prompts.
let signInInFlight: Promise<void> | null = null

export function useSignIn(prefetched?: IssuedNonce) {
  const qc = useQueryClient()
  const { activeAddress, session: walletSession } = useWallet()
  const mutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (signInInFlight) return signInInFlight
      signInInFlight = (async () => {
        if (!walletSession || !activeAddress) {
          throw new Error("Connect a wallet first.")
        }
        const chain = getActiveChain()
        let signingAddress = activeAddress
        try {
          signingAddress = encodeForChain(activeAddress, chain.id)
        } catch {
          /* fall through */
        }

        // Use the pre-fetched nonce when it matches the address we're
        // about to sign for, skipping the fetch hop.
        const issued: IssuedNonce =
          prefetched && prefetched.address === signingAddress
            ? prefetched
            : await requestNonce(signingAddress)

        const meta = getConnectorMeta(walletSession.connectorId)
        const signer: Signer = await meta.connector.getSigner(
          walletSession,
          signingAddress,
        )
        if (!signer.signRaw) {
          throw new Error("This wallet doesn't support raw message signing.")
        }
        let signed
        try {
          signed = await signer.signRaw({
            address: signingAddress,
            data: stringToHex(issued.message),
            type: "bytes",
          })
        } catch (e) {
          // Coerce wallet rejection objects (which are often plain
          // { code, message } rather than Error instances) so the
          // outer toast doesn't render "[object Object]".
          throw new Error(formatError(e))
        }

        const verifyRes = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: signingAddress,
            nonce: issued.nonce,
            signature: signed.signature,
          }),
        })
        const verifyJson = (await verifyRes.json()) as
          | { ok: true }
          | { ok: false; error: string }
        if (!("ok" in verifyJson) || !verifyJson.ok) {
          throw new Error(
            "error" in verifyJson ? verifyJson.error : "Sign-in rejected.",
          )
        }
      })()
      try {
        return await signInInFlight
      } finally {
        signInInFlight = null
        // The cached nonce just got burned server-side. Invalidate so
        // the next sign-in attempt mints a fresh one.
        void qc.invalidateQueries({ queryKey: ["auth-nonce"] })
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ME_KEY })
      // A role cached from before (signed out, or another wallet) is stale.
      void qc.invalidateQueries({ queryKey: MODERATION_KEY })
    },
  })

  // No sync wake from this layer. The caller (account page /
  // comments section) opens the SignRequestModal on click and the
  // modal's "Open in <wallet>" link opens the wallet when the user
  // taps it - that's the iOS-reliable mechanism the pair flow uses.
  // signClient.request still publishes the request to the relay; the
  // wallet picks it up over its existing session.
  const submit = useCallback(() => {
    return mutation.mutateAsync()
  }, [mutation])

  return {
    submit,
    isPending: mutation.isPending,
  }
}

export function useSignOut() {
  const qc = useQueryClient()
  const reset = useCallback(() => {
    void qc.setQueryData(ME_KEY, null)
    void qc.setQueryData([...MODERATION_KEY, "me"], null)
    void qc.invalidateQueries({ queryKey: ME_KEY })
    void qc.invalidateQueries({ queryKey: MODERATION_KEY })
  }, [qc])
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST" })
    },
    onSuccess: reset,
    onError: reset,
  })
}

/**
 * The wallet modal's account-switch rule, for code that changes the active
 * account outside the modal (wallet restore falling back to another
 * account): the sign-in session was minted for one public key, so it is
 * dropped when `address` is a different account.
 */
export function useSignOutIfOtherAccount(): (address: string) => Promise<void> {
  const qc = useQueryClient()
  const { mutateAsync: signOut } = useSignOut()
  return useCallback(
    async (address: string) => {
      const me = await qc.fetchQuery({ queryKey: ME_KEY, queryFn: fetchMe })
      if (me && !samePublicKey(me.address, address)) await signOut()
    },
    [qc, signOut],
  )
}

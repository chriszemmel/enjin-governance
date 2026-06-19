"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import type { Signer } from "@polkadot/api/types"
import { stringToHex } from "@polkadot/util"
import { encodeForChain } from "@/lib/chain/ss58"
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
 * page. The voting flow auto-opens the wallet on mobile because
 * click → signAndSend has no async hops between them, so iOS Safari
 * still considers the synthetic deep-link click a user gesture. A
 * network round-trip to /api/auth/nonce in the sign-in path would spend
 * that gesture before signRaw fires the wake deep link, leaving the
 * wallet to not auto-open. Pre-fetching the nonce here keeps the path
 * hop-free, so sign-in feels identical to voting.
 *
 * Refresh well inside the server-side TTL (5 min) so the cached nonce
 * is always live. We don't poll faster - each request mints a fresh
 * entry server-side, so over-refreshing just bloats the in-memory map.
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

/**
 * Current sign-in state. Returns the connected user when the session
 * cookie is valid, otherwise null. Polls every 60s so a server-side
 * logout (cookie expiry, manual DB delete) propagates.
 */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" })
      if (res.status === 401) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { ok: true; user: Me }
      return json.user
    },
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
        // about to sign for. Skipping the fetch hop here is what lets
        // the wake deep link fire inside the user-gesture window so
        // iOS Safari auto-opens the wallet - same timing as voting.
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
    },
  })

  // No sync wake from this layer. The caller (account page /
  // comments section) opens the SignRequestModal on click and the
  // modal's "Open in Enjin Wallet" button fires the deep link from
  // its own click frame - that's the iOS-reliable mechanism the pair
  // flow uses. signClient.request still publishes the request to the
  // relay; the wallet picks it up over its existing session.
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
    void qc.invalidateQueries({ queryKey: ME_KEY })
  }, [qc])
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST" })
    },
    onSuccess: reset,
    onError: reset,
  })
}

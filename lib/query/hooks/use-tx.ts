"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ApiPromise } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { EventRecord } from "@polkadot/types/interfaces"
import type { ISubmittableResult } from "@polkadot/types/types"
import { decodeDispatchError } from "@/lib/chain/events"
import { encodeForChain } from "@/lib/chain/ss58"
import { getActiveChain } from "@/lib/chain/use-chain"
import { getConnectorMeta } from "@/lib/wallet/connector-registry"
import { useWallet } from "@/lib/wallet/use-wallet"
import { useApi } from "./use-api"
import { queryKeys } from "@/lib/query/keys"
import { formatError } from "@/lib/utils/format-error"

type AnyExtrinsic = SubmittableExtrinsic<"promise", ISubmittableResult>
type Builder = (api: ApiPromise) => AnyExtrinsic | AnyExtrinsic[]

async function waitForApiConnected(api: ApiPromise, timeoutMs: number): Promise<void> {
  if (api.isConnected) return
  await new Promise<void>((resolve, reject) => {
    const onConnected = () => {
      cleanup()
      resolve()
    }
    const onTimeout = () => {
      cleanup()
      reject(
        new Error(
          "Chain RPC is reconnecting - please try again in a moment.",
        ),
      )
    }
    const timer = setTimeout(onTimeout, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      api.off("connected", onConnected)
    }
    api.on("connected", onConnected)
    // The provider may have flipped to connected between the caller's
    // check and our listener being attached. Re-check once.
    if (api.isConnected) onConnected()
  })
}

export type TxStatus =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "broadcast"; txHash: string }
  | { kind: "in-block"; blockHash: string; txHash: string }
  | { kind: "finalized"; blockHash: string; txHash: string; events: EventRecord[] }
  | { kind: "error"; message: string }

type ExtrinsicSuccess = {
  blockHash: string
  txHash: string
  events: EventRecord[]
  result: ISubmittableResult
}

type UseExtrinsicOptions = {
  build: Builder
  /** Called on every status transition. */
  onStatus?: (status: TxStatus) => void
  /** Called once when the tx reaches `resolveOn`. */
  onSuccess?: (success: ExtrinsicSuccess) => void
  /** Called when the extrinsic fails (signing or dispatch error). */
  onError?: (message: string) => void
  /**
   * When `onSuccess` fires and the submit() promise resolves.
   *
   * "in-block" (default): the block author has included the tx and we've
   * seen its events. ~12s faster perceived completion on Enjin Relay; a
   * (very rare) chain reorg could silently drop it, in which case the
   * caller's only fallback is "user re-submits". Good for votes, deposit
   * placements, and other idempotent or easily-retryable actions.
   *
   * "finalized": wait for GRANDPA. Use this for irreversible side effects
   * - anything that writes the on-chain event payload (e.g. a referendum
   * index) into the database, since a reorg would persist the wrong row.
   */
  resolveOn?: "in-block" | "finalized"
}

/**
 * Build → sign → broadcast → watch → invalidate.
 *
 * `build` receives the live ApiPromise and returns either a single extrinsic
 * or an array (which we wrap in utility.batchAll so the steps either all
 * apply or all revert).
 *
 * The mutation resolves on finalisation with the decoded events and the
 * finalised block hash. Both pre-flight build errors and dispatchError
 * variants are decoded via api.registry.findMetaError and surfaced through
 * onError so the UI never gets stuck in 'signing' on a thrown build call.
 */
export function useExtrinsic(options: UseExtrinsicOptions) {
  const apiQuery = useApi()
  const { activeAddress, session } = useWallet()
  const queryClient = useQueryClient()
  const [status, setStatusState] = useState<TxStatus>({ kind: "idle" })

  // Keep options stable across renders without rebuilding the mutation.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const setStatus = useCallback((next: TxStatus) => {
    setStatusState(next)
    optionsRef.current.onStatus?.(next)
  }, [])

  // Handle for the live `send()` subscription. polkadot-js auto-unsubscribes
  // once a terminal status (finalized) arrives, but on the STUCK_TIMEOUT path
  // - where the inBlock/finalized notifications are lost entirely - no
  // terminal status ever comes, so the subscription would leak and later fire
  // setStatus into a hook the user has moved on from. We capture the unsub fn
  // so the error/timeout paths and unmount can tear it down explicitly.
  const unsubRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [])

  const mutation = useMutation<ExtrinsicSuccess, Error, void>({
    mutationFn: async () => {
      try {
        return await runMutation()
      } catch (e) {
        const message = formatError(e)
        setStatus({ kind: "error", message })
        optionsRef.current.onError?.(message)
        throw e
      }
    },
  })

  async function runMutation(): Promise<ExtrinsicSuccess> {
    const api = apiQuery.data
    if (!api) throw new Error("Chain RPC is not ready yet - try again in a moment.")
    if (!session || !activeAddress) {
      throw new Error("Connect a wallet before submitting.")
    }

    setStatus({ kind: "signing" })

    const built = optionsRef.current.build(api)
    const txs = Array.isArray(built) ? built : [built]
    const tx: AnyExtrinsic =
      txs.length === 1
        ? txs[0]!
        : (api.tx.utility.batchAll(txs) as AnyExtrinsic)

    const meta = getConnectorMeta(session.connectorId)

    // Re-encode the connected address to the active chain's SS58 prefix
    // before signing. The wallet keys its WC account list by CAIP-10
    // strings - a request whose address is encoded for a different chain
    // than `chainId` is silently dropped. Bit us when the user connected
    // with the mainnet relay active (`en…`) and switched to canary (`cn…`).
    const activeChain = getActiveChain()
    // Bind the chain we're signing for *now*. A chain switch between submit
    // and finalize (reachable silently via a `?network=` deep link) must not
    // redirect the post-success cache invalidation to a different chain's
    // referenda list than the one this tx was actually submitted to.
    const txChainId = activeChain.id
    let signingAddress = activeAddress
    try {
      signingAddress = encodeForChain(activeAddress, activeChain.id)
    } catch {
      // Leave as-is - invalid SS58 surfaces through the wallet's error.
    }

    const signer = await meta.connector.getSigner(session, signingAddress)

    // iOS Safari suspends background tabs aggressively. While the user
    // is over in the wallet signing, our @polkadot/api WsProvider's
    // socket to the chain RPC closes. By the time we get back here
    // with a signed extrinsic, the WsProvider hasn't always finished
    // re-establishing - author_submitAndWatchExtrinsic on a dead
    // socket throws "WebSocket is not connected" and the user sees a
    // failed vote even though they signed successfully.
    //
    // tx.signAndSend(...) is a single call that signs AND broadcasts
    // internally, so we can't insert the wait between them. Split it:
    // signAsync first (which round-trips to the wallet), THEN wait
    // for the WS to come back, THEN send.
    // Sign with an immortal era (era: 0). signAsync freezes the nonce AND
    // era into the signature at sign time - but on this hardened mobile path
    // we then deliberately wait up to 15s for the WS to reconnect *after*
    // signing, and the wallet round-trip itself can take minutes on iOS. With
    // the default ~64-block mortal era that window can lapse before we
    // broadcast, and the node rejects the signed tx with "bad signature /
    // ancient birth block" - losing a vote/submit the user already approved.
    // These governance txs are still nonce-guarded against replay, so trading
    // mortality for not dropping a freshly-signed submission is the right call.
    const signed = await tx.signAsync(signingAddress, { signer, era: 0 })
    if (!api.isConnected) {
      await waitForApiConnected(api, 15_000)
    }

    const resolveOn = optionsRef.current.resolveOn ?? "in-block"

    return new Promise<ExtrinsicSuccess>((resolve, reject) => {
      let settled = false
      let stuckTimer: ReturnType<typeof setTimeout> | null = null

      // Tear down the send() subscription (no-op if it already auto-unsubbed
      // on a terminal status). Called from the error/timeout paths so a lost-
      // notification subscription doesn't linger.
      const teardownSubscription = () => {
        unsubRef.current?.()
        unsubRef.current = null
      }

      // Guard rests inside fireSuccess so the isFinalized fallback below
      // can call it unconditionally without double-firing onSuccess / the
      // cache invalidations when isInBlock has already settled.
      const fireSuccess = (success: ExtrinsicSuccess) => {
        if (settled) return
        settled = true
        if (stuckTimer) clearTimeout(stuckTimer)
        optionsRef.current.onSuccess?.(success)
        queryClient.invalidateQueries({
          queryKey: queryKeys.referenda.all(txChainId),
        })
        queryClient.invalidateQueries({ queryKey: ["balance"] })
        resolve(success)
      }

      const fireError = (message: string) => {
        if (settled) return
        settled = true
        if (stuckTimer) clearTimeout(stuckTimer)
        teardownSubscription()
        setStatus({ kind: "error", message })
        optionsRef.current.onError?.(message)
        reject(new Error(message))
      }

      // Safety net for the rare case where the wallet's WC relay or our
      // RPC drops the inBlock / finalized notifications entirely (we've
      // seen this on mobile when Safari suspends the tab during signing).
      // 90s is ~5x normal Enjin Relay finalization; if we hit it, the
      // chain almost certainly already accepted the tx - we just lost
      // the subscription. Surface as an error the user can dismiss + retry
      // rather than leaving the panel spinning on "Broadcasting…".
      const STUCK_TIMEOUT_MS = 90_000
      stuckTimer = setTimeout(() => {
        fireError(
          "Lost contact with the chain after broadcasting your transaction.\nIt may still have gone through - refresh to check, or tap Retry to send a fresh one.",
        )
      }, STUCK_TIMEOUT_MS)

      const sendPromise = signed.send((result) => {
        const txHash = tx.hash.toHex()

        if (result.dispatchError) {
          fireError(decodeDispatchError(api, result.dispatchError))
          return
        }

        if (result.isError) {
          fireError("Transaction failed before reaching a block.")
          return
        }

        if (result.status.isBroadcast) {
          setStatus({ kind: "broadcast", txHash })
        }
        if (result.status.isInBlock) {
          const blockHash = result.status.asInBlock.toHex()
          setStatus({ kind: "in-block", blockHash, txHash })
          if (resolveOn === "in-block") {
            fireSuccess({
              blockHash,
              txHash,
              events: [...result.events],
              result,
            })
          }
        }
        if (result.status.isFinalized) {
          const blockHash = result.status.asFinalized.toHex()
          const events = [...result.events]
          setStatus({ kind: "finalized", blockHash, txHash, events })
          // Always fire here. The isInBlock notification can be dropped
          // by the wallet's WC relay or a flaky RPC (esp. on mobile when
          // Safari briefly suspends the tab during signing). Without
          // this fallback an inBlock-resolution flow would hang on
          // "Broadcasting…" even though the chain already finalised the
          // tx. The `settled` guard inside fireSuccess makes this a
          // no-op when inBlock already settled.
          fireSuccess({ blockHash, txHash, events, result })
        }
      })

      sendPromise
        .then((unsub) => {
          // If a terminal status already settled this promise before the
          // subscription handle resolved, unsubscribe immediately; otherwise
          // stash it so fireError / STUCK_TIMEOUT / unmount can tear it down.
          if (settled) {
            unsub()
            return
          }
          unsubRef.current = unsub
        })
        .catch((err: unknown) => {
          fireError(formatError(err))
        })
    })
  }

  const reset = useCallback(() => {
    setStatus({ kind: "idle" })
    mutation.reset()
  }, [mutation, setStatus])

  // Single-flight guard: drop re-entrant submit() calls and hand them
  // the in-flight promise instead of starting a second mutation.
  //
  // Background: a tap on the submit button can produce two synthetic
  // click events in a single JS tick on mobile (iOS Safari's pattern,
  // documented for sign-in too) - `tx.isSubmitting` doesn't read true
  // until React re-renders, so the button's `disabled` doesn't help.
  // Without this guard, the second click ran a second mutation in
  // parallel, each issuing its own `signClient.request` with a fresh
  // RPC id; the WC SDK can't dedupe two genuinely distinct requests,
  // so Enjin Wallet stacked two sign sheets. The user signed the first
  // one, came back to a still-spinning dapp (the SECOND mutation owned
  // the visible modal), and only the second signature actually closed
  // the loop. Same shape as the `signInInFlight` lock in use-session.
  const inFlightRef = useRef<Promise<ExtrinsicSuccess> | null>(null)
  const submit = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current
    const p = mutation.mutateAsync().finally(() => {
      inFlightRef.current = null
    })
    inFlightRef.current = p
    return p
  }, [mutation])

  return {
    status,
    submit,
    isSubmitting: mutation.isPending,
    reset,
  }
}

"use client"

import { useEffect, useState } from "react"
import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { env } from "@/lib/env"
import { type ChainConfig, type ChainId, getChain } from "./chains"

type ChainStore = {
  chainId: ChainId
  setChainId: (id: ChainId) => void
}

/**
 * Persists the chosen network to localStorage. Initial value comes from
 * NEXT_PUBLIC_DEFAULT_NETWORK so a fresh visitor lands on whatever the
 * deployment chose.
 */
const useChainStore = create<ChainStore>()(
  persist(
    (set) => ({
      chainId: env.NEXT_PUBLIC_DEFAULT_NETWORK,
      setChainId: (chainId) => set({ chainId }),
    }),
    {
      name: "enjin-governance:chain",
      storage: createJSONStorage(() => localStorage),
    },
  ),
)

/** Reactive: subscribes to changes. Use inside React components / hooks. */
export function useActiveChain(): ChainConfig {
  const chainId = useChainStore((s) => s.chainId)
  return getChain(chainId)
}

/**
 * Reactive flag - true once zustand has merged the persisted localStorage
 * value into the store. Before that, `useActiveChain` returns the env
 * default, which produces a flash ("Connecting to Enjin Relay…") on canary
 * deployments before the persisted "canary-relay" preference lands. Gate
 * any chain-identifying UI on this so the user never sees a chain we're
 * about to overwrite a tick later.
 *
 * Always returns `false` on the server / first client paint - the persist
 * middleware's API only exists in the browser, and SSR has no notion of
 * hydration anyway. The effect promotes it on the client once persist
 * fires `onFinishHydration` (or already did).
 */
export function useChainHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    const persistApi = useChainStore.persist
    if (!persistApi) {
      // Defensive: persist middleware should always attach this on the
      // client; if it doesn't there's nothing to wait for.
      setHydrated(true)
      return
    }
    const unsub = persistApi.onFinishHydration(() => setHydrated(true))
    if (persistApi.hasHydrated()) setHydrated(true)
    return () => {
      unsub()
    }
  }, [])
  return hydrated
}

/** Reactive setter - call to switch networks at runtime. */
export function useSetActiveChain() {
  return useChainStore((s) => s.setChainId)
}

/**
 * Non-reactive accessor. Returns the current chain at the moment of call.
 * Use only from non-React code (wallet connectors, event handlers) where
 * subscribing isn't possible. On the server it returns the env default.
 */
export function getActiveChain(): ChainConfig {
  return getChain(useChainStore.getState().chainId)
}

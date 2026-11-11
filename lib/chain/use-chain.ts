"use client"

import { useSyncExternalStore } from "react"
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
 * `false` on the server and while a server-rendered page hydrates (the
 * persist middleware only exists in the browser); true straight away on a
 * client-side navigation once persist has hydrated.
 */
export function useChainHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useChainStore.persist?.onFinishHydration(onChange) ?? (() => {}),
    // Defensive: without the persist middleware there's nothing to wait for.
    () => useChainStore.persist?.hasHydrated() ?? true,
    () => false,
  )
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

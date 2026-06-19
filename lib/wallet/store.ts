"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { ConnectedSession, ConnectorId } from "./connectors/types"
import { getConnectorMeta } from "./connector-registry"

type WalletStatus = "disconnected" | "connecting" | "connected" | "error"

type WalletState = {
  status: WalletStatus
  connectorId: ConnectorId | null
  session: ConnectedSession | null
  activeAddress: string | null
  error: string | null

  // Actions
  setConnecting(connectorId: ConnectorId): void
  setConnected(session: ConnectedSession): void
  setError(message: string): void
  setActiveAddress(address: string): void
  reset(): void
}

const PERSIST_KEY = "enjin-governance:wallet"

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      status: "disconnected",
      connectorId: null,
      session: null,
      activeAddress: null,
      error: null,

      setConnecting(connectorId) {
        set({ status: "connecting", connectorId, error: null })
      },

      setConnected(session) {
        const first = session.accounts[0] ?? null
        set({
          status: "connected",
          connectorId: session.connectorId,
          session,
          activeAddress: get().activeAddress ?? first?.address ?? null,
          error: null,
        })
      },

      setError(message) {
        set({ status: "error", error: message })
      },

      setActiveAddress(address) {
        set({ activeAddress: address })
      },

      reset() {
        set({
          status: "disconnected",
          connectorId: null,
          session: null,
          activeAddress: null,
          error: null,
        })
      },
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist enough to restore - we re-fetch the live session on mount.
      partialize: (state) => ({
        connectorId: state.connectorId,
        activeAddress: state.activeAddress,
      }),
    },
  ),
)

// Called once on app boot to rehydrate the live session from the connector
// after a page reload.
let restorePromise: Promise<void> | null = null

export async function restoreWallet(): Promise<void> {
  if (restorePromise) return restorePromise
  restorePromise = (async () => {
    const { connectorId, activeAddress, setConnected, reset } = useWalletStore.getState()
    if (!connectorId) return
    try {
      const meta = getConnectorMeta(connectorId)
      const session = await meta.connector.restore()
      if (!session) {
        reset()
        return
      }
      setConnected(session)
      if (activeAddress && session.accounts.some((a) => a.address === activeAddress)) {
        useWalletStore.getState().setActiveAddress(activeAddress)
      }
    } catch {
      reset()
    }
  })()
  return restorePromise
}


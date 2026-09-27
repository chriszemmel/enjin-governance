"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { samePublicKey } from "@/lib/chain/ss58"
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

/**
 * The account to make active for `session`: `preferred` while the session
 * still holds it (matched by public key, returned in the session's own
 * encoding), otherwise the session's first account.
 */
export function pickActiveAddress(
  session: ConnectedSession,
  preferred: string | null,
): string | null {
  if (preferred) {
    const kept = session.accounts.find((a) => samePublicKey(a.address, preferred))
    if (kept) return kept.address
  }
  return session.accounts[0]?.address ?? null
}

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
        set({
          status: "connected",
          connectorId: session.connectorId,
          session,
          // The current address may be a persisted one, or from an earlier
          // session - keep it only while this session still holds it.
          activeAddress: pickActiveAddress(session, get().activeAddress),
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
// after a page reload. Resolves with the account restore switched to when
// the persisted one is no longer in the wallet's session (setConnected then
// falls back to the session's first account), otherwise null - so the
// caller can apply the account-switch rules (see WalletRestoreMounter).
let restorePromise: Promise<string | null> | null = null

export async function restoreWallet(): Promise<string | null> {
  if (restorePromise) return restorePromise
  restorePromise = (async () => {
    const { connectorId, activeAddress, setConnected, reset } = useWalletStore.getState()
    if (!connectorId) return null
    try {
      const meta = getConnectorMeta(connectorId)
      const session = await meta.connector.restore()
      if (!session) {
        reset()
        return null
      }
      setConnected(session)
      const restored = useWalletStore.getState().activeAddress
      return activeAddress && restored && !samePublicKey(restored, activeAddress) ? restored : null
    } catch {
      reset()
      return null
    }
  })()
  return restorePromise
}


"use client"

import { useShallow } from "zustand/react/shallow"
import { useWalletStore } from "./store"
import { getConnectorMeta } from "./connector-registry"
import { encodeForChain, shortenAddress } from "@/lib/chain/ss58"
import { type ChainId } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { formatError } from "@/lib/utils/format-error"
import type { ConnectedSession, ConnectorId } from "./connectors/types"

/**
 * Primary wallet hook used by UI. Returns the active connection state and
 * the action handlers components need.
 */
export function useWallet() {
  return useWalletStore(
    useShallow((s) => ({
      status: s.status,
      connectorId: s.connectorId,
      session: s.session,
      activeAddress: s.activeAddress,
      error: s.error,
      setActiveAddress: s.setActiveAddress,
    })),
  )
}

type ConnectArgs = { connectorId: ConnectorId; onUri?: (uri: string) => void }

type ConnectActions = {
  /**
   * Initiate a connect flow for `connectorId`. Resolves with the live
   * session so the caller can present an account picker before setting
   * an active address. Throws on failure.
   */
  connect: (args: ConnectArgs) => Promise<ConnectedSession>
  /** Tear down the current session. */
  disconnect: () => Promise<void>
}

/** Imperative actions, kept separate so render-time selectors don't pull them. */
export function useWalletActions(): ConnectActions {
  const { setConnecting, setConnected, setError, reset, session } = useWalletStore.getState()

  return {
    async connect({ connectorId, onUri }) {
      setConnecting(connectorId)
      try {
        const meta = getConnectorMeta(connectorId)
        const newSession = await meta.connector.connect({ onUri })
        setConnected(newSession)
        return newSession
      } catch (err) {
        setError(formatError(err))
        throw err
      }
    },

    async disconnect() {
      if (!session) {
        reset()
        return
      }
      try {
        const meta = getConnectorMeta(session.connectorId)
        await meta.connector.disconnect(session)
      } finally {
        reset()
      }
    },
  }
}

/** Display the active address re-encoded to the active chain's SS58 prefix. */
export function useDisplayAddress(chainId?: ChainId): {
  full: string | null
  short: string | null
} {
  const activeChain = useActiveChain()
  const targetChainId = chainId ?? activeChain.id
  const { activeAddress } = useWallet()
  if (!activeAddress) return { full: null, short: null }
  try {
    const reencoded = encodeForChain(activeAddress, targetChainId)
    return { full: reencoded, short: shortenAddress(reencoded) }
  } catch {
    return { full: activeAddress, short: shortenAddress(activeAddress) }
  }
}

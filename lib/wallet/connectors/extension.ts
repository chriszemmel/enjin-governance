"use client"

import type { Signer } from "@polkadot/api/types"
import { APP_NAME } from "@/lib/config"
import type {
  ConnectedSession,
  Connector,
  ConnectorId,
  DetectionState,
  WalletAccount,
} from "./types"

const DETECTION_RETRIES = 4
const DETECTION_DELAY_MS = 150

async function importExtensionDapp() {
  return import("@polkadot/extension-dapp")
}

/**
 * Some extensions inject after window.load. Poll a few times before giving
 * up so a fast page load doesn't show "not installed" for a wallet the
 * user actually has.
 */
async function detectInjected(source: string): Promise<DetectionState> {
  if (typeof window === "undefined") return "n/a"
  for (let attempt = 0; attempt < DETECTION_RETRIES; attempt++) {
    const injected = (window as { injectedWeb3?: Record<string, unknown> }).injectedWeb3
    if (injected && injected[source]) return "installed"
    if (attempt < DETECTION_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, DETECTION_DELAY_MS))
    }
  }
  return "not-installed"
}

/**
 * Build a connector for a Polkadot extension-dapp injector identified by
 * its `source` (the key the extension uses in window.injectedWeb3).
 *
 * Polkadot.js, Talisman, SubWallet, and PolkaGate all conform to this
 * interface, so the same connector code drives all four.
 */
function createExtensionConnector(id: ConnectorId, source: string): Connector {
  return {
    id,

    detect: () => detectInjected(source),

    async connect(): Promise<ConnectedSession> {
      const { web3Enable, web3Accounts } = await importExtensionDapp()
      const enabled = await web3Enable(APP_NAME)
      if (enabled.length === 0) {
        throw new Error(
          "No extension authorised the connection. Reload the page if the prompt didn't appear.",
        )
      }
      const allAccounts = await web3Accounts({ extensions: [source] })
      const accounts: WalletAccount[] = allAccounts.map((a) => ({
        address: a.address,
        name: a.meta.name,
        source: id,
      }))
      if (accounts.length === 0) {
        throw new Error(
          `No accounts found in ${id}. Add or import a Polkadot account and reconnect.`,
        )
      }
      return { connectorId: id, accounts, meta: { source } }
    },

    async disconnect(): Promise<void> {
      // Extensions don't expose a "disconnect this dapp" API - the user
      // revokes per-origin authorisation from within the extension UI.
      // We just drop the local session.
    },

    async getSigner(_session: ConnectedSession, address: string): Promise<Signer> {
      const { web3FromAddress } = await importExtensionDapp()
      const injected = await web3FromAddress(address)
      return injected.signer as Signer
    },

    async restore(): Promise<ConnectedSession | null> {
      // Extensions remember per-origin authorisation, so we re-call
      // web3Enable on restore. If the user previously approved, this
      // resolves without showing a prompt.
      if (typeof window === "undefined") return null
      const state = await detectInjected(source)
      if (state !== "installed") return null
      try {
        const { web3Enable, web3Accounts } = await importExtensionDapp()
        const enabled = await web3Enable(APP_NAME)
        if (enabled.length === 0) return null
        const allAccounts = await web3Accounts({ extensions: [source] })
        if (allAccounts.length === 0) return null
        return {
          connectorId: id,
          accounts: allAccounts.map((a) => ({
            address: a.address,
            name: a.meta.name,
            source: id,
          })),
          meta: { source },
        }
      } catch {
        return null
      }
    },
  }
}

export const polkadotJsConnector = createExtensionConnector("polkadot-js", "polkadot-js")
export const talismanConnector = createExtensionConnector("talisman", "talisman")
export const subWalletConnector = createExtensionConnector("subwallet-js", "subwallet-js")
export const polkaGateConnector = createExtensionConnector("polkagate", "polkagate")

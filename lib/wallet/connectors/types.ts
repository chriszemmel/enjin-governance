/**
 * Shared Connector contract. Every supported wallet implements this so the
 * UI can render a uniform list and dispatch by connector id.
 */

import type { Signer } from "@polkadot/api/types"

export type ConnectorId =
  | "enjin-wallet"
  | "walletconnect"
  | "polkadot-js"
  | "talisman"
  | "subwallet-js"
  | "polkagate"

export type WalletAccount = {
  address: string
  name?: string
  source: ConnectorId
}

export type ConnectedSession = {
  connectorId: ConnectorId
  accounts: WalletAccount[]
  /** Connector-specific state (e.g. WalletConnect session topic). */
  meta: Record<string, unknown>
}

export type DetectionState = "installed" | "not-installed" | "n/a"

export type ConnectOptions = {
  /** Called as soon as the connector knows how to display itself in the modal. */
  onUri?: (uri: string) => void
}

export interface Connector {
  id: ConnectorId
  /** Whether the user has this wallet available. */
  detect(): Promise<DetectionState>
  /** Initiate a fresh session. */
  connect(options?: ConnectOptions): Promise<ConnectedSession>
  /** Tear down the session. */
  disconnect(session: ConnectedSession): Promise<void>
  /** Get a polkadot.js Signer for the active address in this session. */
  getSigner(session: ConnectedSession, address: string): Promise<Signer>
  /** Re-hydrate a previously-persisted session. Returns null when unavailable. */
  restore(): Promise<ConnectedSession | null>
  /**
   * Synchronously open the wallet app on mobile so the upcoming sign
   * request appears in the foreground. Must be invoked from inside a
   * user-gesture event handler (a click), BEFORE any await - iOS
   * Safari only honours `<a>.click()` deep links while the gesture
   * token is still alive. Connectors that don't need it (browser
   * extensions on desktop) implement it as a no-op.
   */
  wakeWallet?(session: ConnectedSession): void
}

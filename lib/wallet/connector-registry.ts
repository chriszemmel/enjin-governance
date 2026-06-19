import type { Connector, ConnectorId } from "./connectors/types"
import {
  enjinWalletConnector,
  walletConnectConnector,
} from "./connectors/walletconnect"
import {
  polkadotJsConnector,
  polkaGateConnector,
  subWalletConnector,
  talismanConnector,
} from "./connectors/extension"

export type ConnectorMeta = {
  id: ConnectorId
  name: string
  /** Path under /public/brand/wallets - served by Next.js as a static asset. */
  icon: string
  /** Where to send users who haven't installed this wallet. */
  installUrl: string | null
  /** Pin to the top of the modal as a "featured" choice. */
  featured?: boolean
  /** Sub-label rendered under the name. */
  description?: string
  /** Connector implementation. */
  connector: Connector
}

/**
 * Order matters - this is the order they render in the connect modal.
 * Enjin Wallet first (Enjin's flagship), generic WalletConnect second
 * (Nova, Talisman mobile, any other WC-compatible mobile wallet), then
 * the four desktop extensions in adoption order.
 */
export const CONNECTOR_REGISTRY: ConnectorMeta[] = [
  {
    id: "enjin-wallet",
    name: "Enjin Wallet",
    icon: "/brand/wallets/enjin.png",
    installUrl: "https://enjin.io/products/wallet",
    featured: true,
    description: "Mobile-first wallet, WalletConnect QR or deep link",
    connector: enjinWalletConnector,
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    icon: "/brand/wallets/walletconnect.png",
    installUrl: null,
    featured: true,
    description: "Any WalletConnect-compatible Polkadot wallet",
    connector: walletConnectConnector,
  },
  {
    id: "polkadot-js",
    name: "Polkadot.js",
    icon: "/brand/wallets/polkadot-js.png",
    installUrl: "https://polkadot.js.org/extension/",
    description: "Browser extension",
    connector: polkadotJsConnector,
  },
  {
    id: "talisman",
    name: "Talisman",
    icon: "/brand/wallets/talisman.png",
    installUrl: "https://talisman.xyz/download",
    description: "Browser extension",
    connector: talismanConnector,
  },
  {
    id: "subwallet-js",
    name: "SubWallet",
    icon: "/brand/wallets/subwallet.png",
    installUrl: "https://subwallet.app/download.html",
    description: "Browser extension",
    connector: subWalletConnector,
  },
  {
    id: "polkagate",
    name: "PolkaGate",
    icon: "/brand/wallets/polkagate.png",
    installUrl: "https://polkagate.xyz/",
    description: "Browser extension",
    connector: polkaGateConnector,
  },
]

export function getConnectorMeta(id: ConnectorId): ConnectorMeta {
  const meta = CONNECTOR_REGISTRY.find((c) => c.id === id)
  if (!meta) throw new Error(`Unknown connector id: ${id}`)
  return meta
}

/**
 * Resolve the user-facing wallet name + icon for a live session.
 *
 * For the dedicated connectors (Enjin Wallet, Polkadot.js, …) we use
 * the bundled registry entry - the user picked that brand explicitly,
 * and the peer-supplied metadata is sometimes misleading (Enjin Wallet
 * advertises an Ethereum diamond as its WC peer icon, for example).
 *
 * Only the generic `walletconnect` connector falls back to the peer
 * metadata, since that's the connector where the actual paired wallet
 * could be anything - Nova, Talisman Mobile, SubWallet Mobile, etc. -
 * and the registry entry is just "WalletConnect" + the WC logo.
 *
 * Returns a sane default when there's no session yet - the modal
 * renders correctly during the brief window before the connector
 * hands back state.
 */
export function walletDisplayFor(
  session: { connectorId: ConnectorId; meta?: Record<string, unknown> } | null,
): { name: string; icon: string } {
  if (!session) {
    return { name: "wallet", icon: "/brand/wallets/enjin.png" }
  }
  const fallback = getConnectorMeta(session.connectorId)
  if (session.connectorId !== "walletconnect") {
    return { name: fallback.name, icon: fallback.icon }
  }
  const peerName =
    typeof session.meta?.peerName === "string" && session.meta.peerName.length > 0
      ? (session.meta.peerName as string)
      : null
  const peerIcon =
    typeof session.meta?.peerIcon === "string" && session.meta.peerIcon.length > 0
      ? (session.meta.peerIcon as string)
      : null
  return {
    name: peerName ?? fallback.name,
    icon: peerIcon ?? fallback.icon,
  }
}

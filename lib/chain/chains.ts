/**
 * Chain registry - single source of truth for every network the app can
 * talk to. RPC URLs, SS58 prefixes, ticker symbols, decimals, CAIP-2 IDs,
 * and Subscan deep-link bases live here and nowhere else.
 *
 * Adding a new chain: add an entry to CHAINS keyed by a new ChainId, give
 * it a real genesis-hash-derived CAIP-2 ID, and gate `enabled: false` until
 * the rest of the app actually supports it.
 */

import { env } from "@/lib/env"

// Active-chain state (with runtime switching) lives in ./use-chain.ts.
// This file is the pure registry - chains never appear in or leave it.

export type ChainId = "enjin-relay" | "enjin-matrix" | "canary-relay" | "canary-matrix"

export type ChainConfig = {
  id: ChainId
  name: string
  /** Short label for badges / breadcrumbs. */
  shortName: string
  /** Primary WebSocket RPC URL. */
  rpc: string
  /** Fallback WebSocket RPC URL - used by createApiWithFallback. */
  fallbackRpc: string | null
  /**
   * Archive RPC URL. Used by readers that need historical state
   * (e.g. `api.at(oldBlockHash)`). Dwellir's public endpoints serve
   * archive for Enjin's chains, so we default to those - set to null
   * to fall back to the primary RPC, which on a full node retains
   * only ~256 blocks of history.
   */
  archiveRpc: string | null
  /**
   * SS58 address prefix declared by the chain runtime.
   * Enjin Relay = 2135 (`en…`), Enjin Matrix = 1110 (`ef…`),
   * Canary Relay = 69 (`cn…`),    Canary Matrix = 9030 (`cx…`).
   */
  ss58Prefix: number
  /** Token decimals (planck per whole token = 10^decimals). */
  decimals: number
  /** Display ticker (ENJ on mainnets, cENJ on canary). */
  ticker: string
  /**
   * CAIP-2 chain identifier: "polkadot:<first-32-hex-chars-of-genesis-hash>".
   * Used by WalletConnect namespace declarations.
   */
  caip2: `polkadot:${string}`
  /** Subscan instance base URL (no trailing slash). */
  subscanBase: string
  /** Treasury pallet account (modlpy/trsry-derived in the chain's SS58 prefix). */
  treasuryAddress: string
  /**
   * Collection ID of the staking-pool art NFT family - the "Degens"
   * collection on Enjin Relay. The `tokenId` for each pool comes from
   * `nominationPools.bondedPools(id).tokenId` and addresses an NFT in
   * this collection. Used purely for display (avatars, names). Null
   * when the chain has no associated art collection.
   */
  stakingPoolNftCollectionId: bigint | null
  /**
   * Collection ID of the sENJ multi-token family. Each nomination pool
   * mints its own tokenId in this collection where tokenId === poolId.
   * The voter's `multiTokens.tokenAccounts(collectionId, poolId, account)`
   * balance is their sENJ for that pool - and what
   * `voteManager.vote { SEnj: poolId }` consumes. Null when the chain
   * doesn't expose sENJ (canary / matrix today).
   */
  sEnjCollectionId: bigint | null
  /** CoinGecko id for the live USD price, or null when no liquid market (testnets). */
  coingeckoId: string | null
  /** When false, the chain is scaffolded but no UI surfaces it. */
  enabled: boolean
  /** True for canary / testnet variants. */
  isTestnet: boolean
}

export const CHAINS: Record<ChainId, ChainConfig> = {
  "enjin-relay": {
    id: "enjin-relay",
    name: "Enjin Relaychain",
    shortName: "Enjin Relay",
    rpc: env.NEXT_PUBLIC_ENJIN_RELAY_WSS,
    fallbackRpc: env.NEXT_PUBLIC_ENJIN_RELAY_FALLBACK_WSS,
    archiveRpc: "wss://archive.relay.blockchain.enjin.io",
    ss58Prefix: 2135,
    decimals: 18,
    ticker: "ENJ",
    caip2: "polkadot:d8761d3c88f26dc12875c00d3165f7d6",
    subscanBase: env.NEXT_PUBLIC_ENJIN_SUBSCAN_URL,
    treasuryAddress: "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA",
    stakingPoolNftCollectionId: 2n,
    sEnjCollectionId: 1n,
    coingeckoId: "enjincoin",
    enabled: true,
    isTestnet: false,
  },
  "enjin-matrix": {
    id: "enjin-matrix",
    name: "Enjin Matrixchain",
    shortName: "Enjin Matrix",
    rpc: env.NEXT_PUBLIC_ENJIN_MATRIX_WSS,
    fallbackRpc: env.NEXT_PUBLIC_ENJIN_MATRIX_FALLBACK_WSS,
    archiveRpc: "wss://archive.matrix.blockchain.enjin.io",
    ss58Prefix: 1110,
    decimals: 18,
    ticker: "ENJ",
    caip2: "polkadot:3af4ff48ec76d2efc8476730f423ac07",
    subscanBase: env.NEXT_PUBLIC_MATRIX_SUBSCAN_URL,
    // Matrix uses its own PalletId-derived treasury account. The community
    // wallet multisig is funded from the relay treasury via XCM.
    treasuryAddress: "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH",
    stakingPoolNftCollectionId: null,
    sEnjCollectionId: null,
    coingeckoId: "enjincoin",
    // Disabled: Matrix runs the legacy `democracy` pallet (+ council /
    // technicalCommittee), not the OpenGov stack (referenda +
    // convictionVoting) this app drives. Supporting it is a separate
    // integration, not a config flip.
    enabled: false,
    isTestnet: false,
  },
  "canary-relay": {
    id: "canary-relay",
    name: "Canary Relaychain",
    shortName: "Canary Relay",
    rpc: env.NEXT_PUBLIC_CANARY_RELAY_WSS,
    fallbackRpc: null,
    archiveRpc: "wss://archive.relay.canary.enjin.io",
    // Canary Relay declares ss58Format=69 in its runtime - yields `cn…`
    // display addresses. Wallets that hand back the same pubkey under
    // prefix 2135 (`en…`) get re-encoded via `encodeForChain` at the UI.
    ss58Prefix: 69,
    decimals: 18,
    ticker: "cENJ",
    caip2: "polkadot:735d8773c63e74ff8490fee5751ac07e",
    subscanBase: env.NEXT_PUBLIC_CANARY_SUBSCAN_URL,
    treasuryAddress: "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA",
    // Canary's pool-NFT collection id isn't wired up yet - the multiTokens
    // pallet is present but the canary "Degens" equivalent hasn't been
    // queried. Leave null; the votes-list degrades to the textual
    // "sENJ · pool #N" label until this is set.
    stakingPoolNftCollectionId: null,
    sEnjCollectionId: null,
    coingeckoId: null,
    enabled: true,
    isTestnet: true,
  },
  "canary-matrix": {
    id: "canary-matrix",
    name: "Canary Matrixchain",
    shortName: "Canary Matrix",
    rpc: env.NEXT_PUBLIC_CANARY_MATRIX_WSS,
    fallbackRpc: null,
    archiveRpc: "wss://archive.matrix.canary.enjin.io",
    // Canary Matrix declares ss58Format=9030 in its runtime.
    ss58Prefix: 9030,
    decimals: 18,
    ticker: "cENJ",
    caip2: "polkadot:a37725fd8943d2a524cb7ecc65da438f",
    subscanBase: env.NEXT_PUBLIC_CANARY_MATRIX_SUBSCAN_URL,
    treasuryAddress: "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH",
    stakingPoolNftCollectionId: null,
    sEnjCollectionId: null,
    coingeckoId: null,
    // Disabled: legacy `democracy` pallet, not OpenGov (see enjin-matrix).
    enabled: false,
    isTestnet: true,
  },
}

/** Get a chain by id. Throws on unknown id. */
export function getChain(id: ChainId): ChainConfig {
  const chain = CHAINS[id]
  if (!chain) throw new Error(`Unknown chain id: ${id}`)
  return chain
}

/** List every enabled chain. */
export function enabledChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((c) => c.enabled)
}

/**
 * Build a Subscan referenda-v2 URL for the given chain + referendum index.
 * Returns null if the chain doesn't have a Subscan instance.
 */
export function subscanReferendumUrl(chain: ChainConfig, index: number): string {
  return `${chain.subscanBase}/referenda_v2/${index}`
}

/** Build a Subscan account URL. */
export function subscanAccountUrl(chain: ChainConfig, address: string): string {
  return `${chain.subscanBase}/account/${address}`
}

/** Build a Subscan extrinsic URL. */
export function subscanExtrinsicUrl(chain: ChainConfig, txHash: string): string {
  return `${chain.subscanBase}/extrinsic/${txHash}`
}

/** Build a Subscan preimage URL (UI page; works without an API key). */
export function subscanPreimageUrl(chain: ChainConfig, hash: string): string {
  return `${chain.subscanBase}/preimage/${hash}`
}

/**
 * Build a third-party staking-pool detail URL (nft.io on mainnet relay,
 * Enjin's canonical staking front-end). Returns null when the chain
 * doesn't have a corresponding public pool browser yet.
 */
export function stakingPoolUrl(
  chain: ChainConfig,
  poolId: number,
): string | null {
  if (chain.id === "enjin-relay") {
    return `https://nft.io/staking/pool/${poolId}`
  }
  return null
}

/**
 * Cached ApiPromise pool with retry and timeout.
 *
 * Each unique RPC endpoint gets one long-lived ApiPromise; callers reuse
 * the cached instance rather than opening fresh WebSockets per query.
 *
 * Server routes reuse the cached socket while their instance stays warm and
 * don't disconnect it. An instance that lost its connection is disconnected
 * before a new one is opened, so its provider stops reconnecting in the
 * background.
 *
 * The Polkadot API library (most of it the type registry) is loaded with
 * the first connection rather than with the page, so pages paint and
 * hydrate without parsing it first. Browsers start that load as early as
 * they can (see preloadApiLibrary).
 */

import type * as PolkadotApi from "@polkadot/api"
import type { ApiPromise } from "@polkadot/api"
import type { ChainConfig } from "./chains"

const CONNECT_TIMEOUT_MS = 10_000
const READY_TIMEOUT_MS = 15_000
/**
 * How long an archive node gets, to connect and per request. Its big
 * historical reads - an old runtime's metadata above all, needed to decode
 * a block from before an upgrade - take 5 to 50 s on Enjin's public archive
 * nodes; at the RPC node's 10 s they were dropped and the history never
 * loaded.
 */
const ARCHIVE_TIMEOUT_MS = 60_000

type Timeouts = { connect: number; ready: number }
const RPC_TIMEOUTS: Timeouts = { connect: CONNECT_TIMEOUT_MS, ready: READY_TIMEOUT_MS }
const ARCHIVE_TIMEOUTS: Timeouts = { connect: ARCHIVE_TIMEOUT_MS, ready: ARCHIVE_TIMEOUT_MS }
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1_000

const apiCache = new Map<string, ApiPromise>()
const inFlight = new Map<string, Promise<ApiPromise>>()

let library: Promise<typeof PolkadotApi> | null = null

/** Start loading the Polkadot API library, once; later calls share the load. */
export function preloadApiLibrary(): Promise<typeof PolkadotApi> {
  library ??= import("@polkadot/api").catch((err: unknown) => {
    // A failed chunk load (flaky network) may succeed on the next attempt.
    library = null
    throw err
  })
  return library
}

/** Each open connection's metadata as hex, encoded once. */
const metadataHex = new WeakMap<ApiPromise, `0x${string}`>()

/**
 * The runtime metadata of every open connection, keyed the way
 * ApiPromise.create's `metadata` option looks it up: genesis hash and spec
 * version. A new connection to the same chain at the same runtime - the
 * archive node next to the RPC node - takes it from here instead of
 * downloading several MB again, which an archive node can take longer to
 * serve than a connection is given to open.
 */
function knownMetadata(): Record<string, `0x${string}`> {
  const known: Record<string, `0x${string}`> = {}
  for (const api of apiCache.values()) {
    if (!api.isConnected) continue
    let hex = metadataHex.get(api)
    if (!hex) {
      hex = api.runtimeMetadata.toHex()
      metadataHex.set(api, hex)
    }
    known[`${api.genesisHash.toHex()}-${api.runtimeVersion.specVersion.toString()}`] = hex
  }
  return known
}

async function openConnection(endpoint: string, timeouts: Timeouts): Promise<ApiPromise> {
  const { ApiPromise, WsProvider } = await preloadApiLibrary()
  // The last argument is the timeout of every request on this socket.
  const provider = new WsProvider(endpoint, 1_000, {}, timeouts.connect)

  let createTimer: ReturnType<typeof setTimeout> | undefined
  const create = ApiPromise.create({ provider, noInitWarn: true, metadata: knownMetadata() })
  const createTimeout = new Promise<never>((_, reject) => {
    createTimer = setTimeout(
      () => reject(new Error(`API creation timeout: ${endpoint}`)),
      timeouts.connect,
    )
  })

  let api: ApiPromise
  try {
    api = await Promise.race([create, createTimeout])
  } catch (err) {
    // Timeout won (or create rejected). If create still resolves later,
    // disconnect the orphaned api so we don't leak a socket.
    create.then((a) => a.disconnect()).catch(() => {})
    throw err
  } finally {
    clearTimeout(createTimer)
  }

  let readyTimer: ReturnType<typeof setTimeout> | undefined
  const readyTimeout = new Promise<never>((_, reject) => {
    readyTimer = setTimeout(
      () => reject(new Error(`API ready timeout: ${endpoint}`)),
      timeouts.ready,
    )
  })
  try {
    await Promise.race([api.isReady, readyTimeout])
  } catch (err) {
    // Created but never became ready - disconnect so we don't leak it.
    await api.disconnect().catch(() => {})
    throw err
  } finally {
    clearTimeout(readyTimer)
  }

  return api
}

/**
 * Get a cached ApiPromise for the given endpoint, opening + retrying on demand.
 *
 * Concurrent callers for the same endpoint share a single in-flight connection
 * promise rather than racing to open multiple sockets.
 */
export async function getApi(
  endpoint: string,
  retries = MAX_RETRIES,
  timeouts: Timeouts = RPC_TIMEOUTS,
): Promise<ApiPromise> {
  const cached = apiCache.get(endpoint)
  if (cached && cached.isConnected) return cached
  if (cached && !cached.isConnected) {
    apiCache.delete(endpoint)
    void cached.disconnect().catch(() => undefined)
  }

  const existing = inFlight.get(endpoint)
  if (existing) return existing

  const connectPromise = (async () => {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const api = await openConnection(endpoint, timeouts)
        apiCache.set(endpoint, api)
        return api
      } catch (err) {
        lastError = err
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
        }
      }
    }
    throw new Error(
      `Failed to connect to ${endpoint} after ${retries + 1} attempts: ${String(lastError)}`,
    )
  })()

  inFlight.set(endpoint, connectPromise)
  try {
    return await connectPromise
  } finally {
    inFlight.delete(endpoint)
  }
}

/**
 * The chain's archive connection (its RPC node where it has none). The RPC
 * connection is opened first, so the archive one can reuse its metadata
 * (see knownMetadata); an RPC node that can't be reached only costs that.
 * Archive connections get ARCHIVE_TIMEOUT_MS. Open them only through here,
 * so the one cached per endpoint always has it.
 */
export async function getArchiveApi(
  chain: Pick<ChainConfig, "rpc" | "archiveRpc">,
  retries = MAX_RETRIES,
): Promise<ApiPromise> {
  const endpoint = chain.archiveRpc ?? chain.rpc
  if (endpoint === chain.rpc) return getApi(endpoint, retries)
  await getApi(chain.rpc, retries).catch(() => undefined)
  return getApi(endpoint, retries, ARCHIVE_TIMEOUTS)
}

/** Disconnect a specific cached API. Safe to call when nothing is cached. */
export async function disconnectApi(endpoint: string): Promise<void> {
  const api = apiCache.get(endpoint)
  if (!api) return
  apiCache.delete(endpoint)
  if (api.isConnected) await api.disconnect()
}

/** Disconnect every cached API. Use on process shutdown / hot reload. */
export async function disconnectAllApis(): Promise<void> {
  const endpoints = Array.from(apiCache.keys())
  await Promise.all(endpoints.map((e) => disconnectApi(e)))
}

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

const CONNECT_TIMEOUT_MS = 10_000
const READY_TIMEOUT_MS = 15_000
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

async function openConnection(endpoint: string): Promise<ApiPromise> {
  const { ApiPromise, WsProvider } = await preloadApiLibrary()
  const provider = new WsProvider(endpoint, 1_000, {}, CONNECT_TIMEOUT_MS)

  let createTimer: ReturnType<typeof setTimeout> | undefined
  const create = ApiPromise.create({ provider, noInitWarn: true })
  const createTimeout = new Promise<never>((_, reject) => {
    createTimer = setTimeout(
      () => reject(new Error(`API creation timeout: ${endpoint}`)),
      CONNECT_TIMEOUT_MS,
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
      READY_TIMEOUT_MS,
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
export async function getApi(endpoint: string, retries = MAX_RETRIES): Promise<ApiPromise> {
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
        const api = await openConnection(endpoint)
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

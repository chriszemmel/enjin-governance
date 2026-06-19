/**
 * Primary→fallback connection helper for one-shot reads.
 *
 * Use this in server components / API routes / serverless handlers where
 * you want the call to succeed even if the primary RPC is having a moment.
 * For long-lived browser sessions, prefer getApi() from ./api.ts which
 * caches a single endpoint across the page.
 */

import { ApiPromise, WsProvider } from "@polkadot/api"
import { type ChainConfig } from "./chains"

const CONNECT_TIMEOUT_MS = 10_000

async function tryOpen(endpoint: string): Promise<ApiPromise> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const create = ApiPromise.create({
    provider: new WsProvider(endpoint, 1_000, {}, CONNECT_TIMEOUT_MS),
    noInitWarn: true,
  })
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Connection timeout: ${endpoint}`)),
      CONNECT_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([create, timeout])
  } catch (err) {
    // Timeout won (or create rejected). If create still resolves later,
    // disconnect the orphaned api so we don't leak a socket.
    create.then((api) => api.disconnect()).catch(() => {})
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Open an ApiPromise against `primary`, falling back to `fallback` on failure.
 * The caller is responsible for calling api.disconnect() when done.
 */
export async function createApiWithFallback(
  primary: string,
  fallback: string | null,
): Promise<ApiPromise> {
  try {
    return await tryOpen(primary)
  } catch (primaryError) {
    if (!fallback) throw primaryError
    try {
      return await tryOpen(fallback)
    } catch (fallbackError) {
      throw new Error(
        `Both endpoints failed. primary=${primary} (${String(primaryError)}) ` +
          `fallback=${fallback} (${String(fallbackError)})`,
      )
    }
  }
}

/** Convenience wrapper that pulls primary + fallback from a ChainConfig. */
export async function connectChain(chain: ChainConfig): Promise<ApiPromise> {
  return createApiWithFallback(chain.rpc, chain.fallbackRpc)
}

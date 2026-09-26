/**
 * Has a draft's EGOV1 envelope already reached the chain?
 *
 * Staging a draft again rewrites its proposal.json in place. That is only
 * safe while nothing on chain points at the old bytes - once the submission
 * batch landed, the envelope (url + sha256) is noted as a preimage and bound
 * to a referendum, and rewriting the JSON would break that binding. The
 * envelope preimage is unique per (url, sha256), so its presence is the
 * signal: the batch that noted it also submitted the referendum.
 *
 * Throws when the chain can't be read in time - callers must fail closed.
 */

import "server-only"
import { getApi } from "@/lib/chain/api"
import { CHAINS, type ChainId } from "@/lib/chain/chains"
import { getPreimageStatus } from "./preimage"
import { expectedMetadataHash } from "./proposal-metadata"

/** Same ceiling the confirm route uses for its chain read. */
const CHAIN_READ_DEADLINE_MS = 8_000

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`chain read exceeded ${ms}ms`)), ms).unref?.(),
    ),
  ])
}

export async function isEnvelopeOnChain(
  network: string,
  jsonUrl: string,
  jsonSha256: string,
): Promise<boolean> {
  const chain = CHAINS[network as ChainId]
  if (!chain) throw new Error(`Unknown network ${network}`)
  const hash = expectedMetadataHash(jsonUrl, jsonSha256)
  const status = await withDeadline(
    (async () => {
      // retries = 0: the caller answers fast and the user can simply retry.
      const api = await getApi(chain.rpc, 0)
      return getPreimageStatus(api, hash)
    })(),
    CHAIN_READ_DEADLINE_MS,
  )
  return status !== "Missing"
}

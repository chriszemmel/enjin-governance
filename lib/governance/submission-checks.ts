/**
 * Checks both composers run before they sign a filing batch, so that a
 * retry or a switched wallet never files a referendum nobody meant to file.
 */

import type { ApiPromise } from "@polkadot/api"
import { getChain, type ChainId } from "@/lib/chain/chains"
import { samePublicKey, shortenAddress } from "@/lib/chain/ss58"
import { getReferendum } from "./referenda"

/** How many referenda below `referendumCount()` the landed-batch scan reads. */
export const LANDED_SCAN_DEPTH = 20

/** The two chain reads the scan makes, so tests can fake them. */
export type SubmissionReader = {
  /** `referenda.metadataOf(index)` as a hex hash, or null when unset. */
  metadataOf: (index: number) => Promise<string | null>
  /** Who holds the referendum's submission deposit, or null when none is on record. */
  depositorOf: (index: number) => Promise<string | null>
}

export function chainSubmissionReader(api: ApiPromise): SubmissionReader {
  return {
    metadataOf: async (index) => {
      const raw = await api.query.referenda.metadataOf(index)
      const opt = raw as unknown as { isSome: boolean; unwrap: () => { toHex: () => string } }
      return opt.isSome ? opt.unwrap().toHex() : null
    },
    depositorOf: async (index) => {
      const status = (await getReferendum(api, index))?.status
      if (!status || status.type === "Killed") return null
      return status.submissionDeposit?.who ?? null
    },
  }
}

function sameAccount(a: string, b: string): boolean {
  try {
    return samePublicKey(a, b)
  } catch {
    return false
  }
}

/**
 * The referendum an earlier attempt at this batch already filed, or null.
 *
 * When the status updates are lost after broadcast (the 90 s timeout on a
 * phone), the batch may still have landed. A retry would then read the
 * envelope (and a Lookup call) as noted, leave both notes out, read the
 * next index and sign `[submit, setMetadata]` again: a second, identical
 * referendum and a second submission deposit. So when the draft's envelope
 * is already noted, the composers look here first: a recent referendum
 * whose metadata is this envelope and whose submission deposit this
 * account holds is that earlier attempt, and gets linked instead.
 *
 * Reads the `depth` referenda below `referendumCount`, newest first.
 * Throws when the chain can't be read: the caller must not sign then.
 */
export async function findLandedSubmission(
  reader: SubmissionReader,
  opts: {
    /** blake2-256 of the draft's EGOV1 envelope. */
    envelopeHash: string
    /** The account that staged the draft. */
    proposer: string
    referendumCount: number
    depth?: number
  },
): Promise<number | null> {
  const depth = opts.depth ?? LANDED_SCAN_DEPTH
  const wanted = opts.envelopeHash.toLowerCase()
  const indices: number[] = []
  for (let i = opts.referendumCount - 1; i >= Math.max(0, opts.referendumCount - depth); i--) {
    indices.push(i)
  }
  const hashes = await Promise.all(indices.map((i) => reader.metadataOf(i)))
  for (const [k, index] of indices.entries()) {
    if (hashes[k]?.toLowerCase() !== wanted) continue
    // Anyone can bind a copy of the envelope to their own referendum.
    const depositor = await reader.depositorOf(index)
    if (depositor && sameAccount(depositor, opts.proposer)) return index
  }
  return null
}

/** The network and account a draft was staged for. */
export type StagedFor = { network: ChainId; proposer: string }

/**
 * Why a staged draft must not be signed now, or null when it may be: the
 * network or the wallet's account changed after Review. The draft names
 * its network and proposer, and the server only links it to a referendum
 * that account filed on that network, so a batch signed by anyone else,
 * or elsewhere, would pay a deposit for a referendum that can't be linked.
 */
export function stagedForMismatch(
  staged: StagedFor,
  now: { network: ChainId; address: string | null },
): string | null {
  const stagedOn = getChain(staged.network).shortName
  if (now.network !== staged.network) {
    return `This proposal was staged on ${stagedOn}, but ${getChain(now.network).shortName} is selected now. Switch back to ${stagedOn} to sign it.`
  }
  if (!now.address || !sameAccount(now.address, staged.proposer)) {
    return `This proposal was staged for ${shortenAddress(staged.proposer)}, but another account is connected now. Switch back to that account to sign it.`
  }
  return null
}

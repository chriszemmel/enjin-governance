/**
 * What a referendum's share image shows, read on the server: the published
 * title (our database), the track and the call (the chain). Each source is
 * best effort and bounded; whatever can't be read is left out and the card
 * still renders with the number.
 *
 * Only stable facts are read - no status, tally or time - so the image can
 * be cached on the CDN.
 */

import "server-only"
import type { ApiPromise } from "@polkadot/api"
import { getApi } from "@/lib/chain/api"
import type { ChainConfig } from "@/lib/chain/chains"
import { formatTokenAmount } from "@/lib/chain/format"
import { intentFromPreimage } from "@/lib/governance/call-extract"
import { formatTrackName } from "@/lib/governance/display"
import { localSpendTarget } from "@/lib/governance/payout"
import { getPreimage } from "@/lib/governance/preimage"
import { getReferendum, getReferendumHistory } from "@/lib/governance/referenda"
import { findTrack, getTracks } from "@/lib/governance/tracks"
import type { OngoingStatus } from "@/lib/governance/types"
import { withDeadline } from "@/lib/seo/deadline"
import { loadProposalSeo } from "@/lib/seo/proposal"
import { actionFact, type CardFact } from "./referendum-facts"
import type { ReferendumCard } from "./referendum-card"

/** Crawlers wait a few seconds for an image; leave room to render it. */
const CHAIN_BUDGET_MS = 8_000

type LoadedCard = ReferendumCard & {
  /** False when the chain couldn't be read in time: cache the card briefly. */
  complete: boolean
}

export async function loadReferendumCard(chain: ChainConfig, index: number): Promise<LoadedCard> {
  const [seo, onChain] = await Promise.all([
    loadProposalSeo(chain.id, index),
    withDeadline(readChain(chain, index), CHAIN_BUDGET_MS).catch(() => null),
  ])
  return {
    index,
    title: seo.title,
    track: onChain?.track ?? null,
    fact: onChain?.fact ?? null,
    complete: onChain != null,
  }
}

async function readChain(
  chain: ChainConfig,
  index: number,
): Promise<{ track: string | null; fact: CardFact | null }> {
  const api = await getApi(chain.rpc, 0)
  const referendum = await getReferendum(api, index)
  if (!referendum) return { track: null, fact: null }

  // A decided referendum keeps neither its track nor its call: read them at
  // the block before the decision, from the archive.
  let status: OngoingStatus | null = referendum.status.type === "Ongoing" ? referendum.status : null
  if (!status && referendum.status.type !== "Ongoing") {
    const archive = await getApi(chain.archiveRpc ?? chain.rpc, 0)
    const history = await getReferendumHistory(archive, index, referendum.status.at)
    status = history?.status.type === "Ongoing" ? history.status : null
  }
  if (!status) return { track: null, fact: null }

  const track = findTrack(getTracks(api), status.trackId)
  return {
    track: track ? formatTrackName(track.name) : null,
    fact: await readFact(api, chain, status).catch(() => null),
  }
}

async function readFact(api: ApiPromise, chain: ChainConfig, status: OngoingStatus): Promise<CardFact | null> {
  const proposal = status.proposal
  const bytes =
    "type" in proposal && proposal.type === "Inline"
      ? proposal.bytes
      : ((await getPreimage(api, proposal as { hash: `0x${string}`; len: number }))?.bytes ?? null)
  if (!bytes) return null

  // Today's runtime decodes the calls this app files (an older, pruned one
  // simply leaves the fact out).
  const call = api.registry.createType("Call", bytes)
  const human = call.toHuman() as { args?: Record<string, unknown> }
  const decoded = {
    section: (call as unknown as { section: string }).section,
    method: (call as unknown as { method: string }).method,
    args: human.args ?? {},
  }
  const spend = localSpendTarget(intentFromPreimage(decoded, chain))
  if (spend) return { kind: "amount", text: formatTokenAmount(spend.amount, chain, { maxFractionDigits: 2 }) }
  return actionFact(decoded)
}

"use client"

import { useQuery } from "@tanstack/react-query"
import type { ApiPromise } from "@polkadot/api"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { listVotesOnPoll } from "@/lib/governance/conviction-voting"
import { useApi } from "./use-api"
import { useArchiveApi } from "./use-archive-api"
import { useReferendum } from "./use-referendum"

export type ReferendumVote = {
  voter: string
  trackId: number
  /** Standard vote byte (0x80 | conviction = aye). Kept raw so the UI decoder owns the labels. */
  voteRaw: number | null
  /** Conviction enum index (0..6), redundant with voteRaw but explicit. */
  convictionRaw: number | null
  /** AccountVote.balance as bigint of planck. */
  balance: bigint
  /** voteManager currency: { Enj: null } | { SEnj: N } | null. */
  currencyRaw: unknown
  /** Block height where this vote was last observed - null when we read live state. */
  blockNumber: number | null
  timestamp: number | null
  /** Extrinsic that emitted the vote - only known via off-chain enrichment, null here. */
  extrinsicIndex: string | null
}

/**
 * On-chain voter list for `pollIndex`, read live from
 * `convictionVoting.votingFor`. For terminal referenda we re-read at
 * the finalisation block via the archive RPC so we get the historical
 * voter set (a few voters may have removed their vote after the
 * outcome was decided).
 *
 * No Subscan dependency - works for any chain we have an RPC for,
 * including canary.
 */
export function useReferendumVotes(
  index: number | null | undefined,
  chain?: ChainConfig,
) {
  const active = useActiveChain()
  const target = chain ?? active
  const liveApi = useApi(target)
  const archiveApi = useArchiveApi(target)
  const refQuery = useReferendum(Number.isFinite(index) ? (index as number) : -1, target)

  // For terminal referenda use the archive at finalisation block - 1
  // (where the ref was still Ongoing) so we capture every voter; for
  // ongoing referenda read live state from the primary RPC.
  const ref = refQuery.data
  const finalisedAt =
    ref && ref.status.type !== "Ongoing" && ref.status.type !== "Killed"
      ? ref.status.at
      : ref?.status.type === "Killed"
        ? ref.status.at
        : null
  const useArchive = finalisedAt != null && finalisedAt > 1

  const apiQuery = useArchive ? archiveApi : liveApi

  return useQuery<ReferendumVote[]>({
    queryKey: [
      "referendum-votes",
      target.id,
      index,
      useArchive ? `at:${finalisedAt}` : "live",
    ],
    queryFn: async () => {
      if (index == null || !apiQuery.data) return []
      const api = useArchive
        ? await readAtBlock(apiQuery.data, finalisedAt! - 1)
        : apiQuery.data
      const rows = await listVotesOnPoll(api, index)
      return rows.map<ReferendumVote>((r) => ({
        voter: r.voter,
        trackId: r.trackId,
        voteRaw:
          r.vote.type === "Standard"
            ? encodeStandardVoteByte(r.vote.aye, conviction(r.vote.conviction))
            : null,
        convictionRaw:
          r.vote.type === "Standard" ? conviction(r.vote.conviction) : null,
        balance:
          r.vote.type === "Standard"
            ? r.vote.balance
            : r.vote.type === "Split"
              ? r.vote.aye + r.vote.nay
              : r.vote.aye + r.vote.nay + r.vote.abstain,
        currencyRaw: r.currencyRaw,
        blockNumber: null,
        timestamp: null,
        extrinsicIndex: null,
      }))
    },
    enabled:
      apiQuery.isSuccess &&
      refQuery.isSuccess &&
      index != null &&
      index >= 0,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  })
}

async function readAtBlock(api: ApiPromise, atBlock: number): Promise<ApiPromise> {
  const blockHash = await api.rpc.chain.getBlockHash(atBlock)
  return (await api.at(blockHash)) as unknown as ApiPromise
}

/** Map our Conviction string back to the u8 the chain uses (0..6). */
function conviction(c: string): number {
  const order = [
    "None",
    "Locked1x",
    "Locked2x",
    "Locked3x",
    "Locked4x",
    "Locked5x",
    "Locked6x",
  ]
  const idx = order.indexOf(c)
  return idx >= 0 ? idx : 0
}

function encodeStandardVoteByte(aye: boolean, convictionIdx: number): number {
  return (aye ? 0x80 : 0x00) | (convictionIdx & 0x7f)
}

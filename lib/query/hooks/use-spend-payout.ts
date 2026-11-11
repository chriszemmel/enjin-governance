"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import type { EnactmentState, SpendContext } from "@/lib/governance/lifecycle"
import {
  awardReaders,
  findAwardBlock,
  type PayoutStatus,
  readSpendPeriod,
  readTreasuryProposals,
  resolvePayout,
  type SpendTarget,
} from "@/lib/governance/payout"
import type { EnactmentRecord } from "@/lib/governance/scheduler"
import { useApi } from "./use-api"
import { useArchiveApi } from "./use-archive-api"
import { useSpecVersion } from "./use-spec-version"

/**
 * The payout of a referendum's treasury spend_local, for `getLifecycle`:
 * `treasury.spendPeriod` (read again when the spec changes) and, once the
 * call has been enacted, where its treasury proposal stands. Null when the
 * call isn't a spend_local (`spend` null). Re-read every minute while the
 * payout is outstanding. Once paid, the spend period that paid it is looked
 * up once on the archive node, so the lifecycle can date the payout.
 */
export function useSpendPayout(
  referendumIndex: number,
  spend: SpendTarget | null,
  enactment: { state: EnactmentState | undefined; record: EnactmentRecord | null | undefined },
  chain?: ChainConfig,
): SpendContext | null {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const api = apiQuery.data
  const specVersion = useSpecVersion(target)
  // A runtime constant: read again with each spec, never cached across one.
  const spendPeriod = useMemo(
    () => (api && specVersion != null ? readSpendPeriod(api) : null),
    [api, specVersion],
  )

  // Wait for the archive record (or its failure) so the proposal index it
  // names is used rather than a beneficiary-and-amount match.
  const enacted = enactment.state?.status === "executed" && enactment.record !== undefined
  const record = enactment.record ?? null
  const payoutQuery = useQuery<PayoutStatus>({
    queryKey: [
      "spend-payout",
      target.id,
      referendumIndex,
      spend?.beneficiary ?? null,
      spend?.amount.toString() ?? null,
      record?.block ?? null,
    ],
    queryFn: async () => {
      if (!api || !spend) throw new Error("API not ready")
      const { proposals, approvals } = await readTreasuryProposals(api)
      return resolvePayout({ record, spend, proposals, approvals })
    },
    enabled: apiQuery.isSuccess && spend != null && enacted,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "paid" || status === "none" ? false : 60_000
    },
  })

  // A paid spend: find the period that awarded it. Past blocks don't change,
  // so the answer is kept for the session.
  const archive = useArchiveApi(target)
  const paid = payoutQuery.data?.status === "paid" ? payoutQuery.data : null
  const enactedAt =
    record?.block ?? (enactment.state?.status === "executed" ? enactment.state.block : null)
  const awardQuery = useQuery<number | null>({
    queryKey: ["spend-award", target.id, paid?.proposalIndex ?? null, enactedAt],
    queryFn: async () => {
      const a = archive.data
      if (!a || !api || paid?.proposalIndex == null || enactedAt == null || spendPeriod == null) {
        throw new Error("Archive not ready")
      }
      const head = await api.rpc.chain.getHeader()
      return findAwardBlock({
        enactedAt,
        currentBlock: (head.number as unknown as { toNumber: () => number }).toNumber(),
        spendPeriod,
        ...awardReaders(a, paid.proposalIndex),
      })
    },
    enabled:
      archive.isSuccess &&
      apiQuery.isSuccess &&
      paid?.proposalIndex != null &&
      enactedAt != null &&
      spendPeriod != null,
    staleTime: Infinity,
    retry: 2,
  })

  if (!spend) return null
  const payout: PayoutStatus = paid
    ? { ...paid, block: awardQuery.data ?? null }
    : (payoutQuery.data ?? { status: "unknown" })
  return { spendPeriod, payout }
}

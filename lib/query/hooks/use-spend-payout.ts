"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import type { EnactmentState, SpendContext } from "@/lib/governance/lifecycle"
import {
  type PayoutStatus,
  readSpendPeriod,
  readTreasuryProposals,
  resolvePayout,
  type SpendTarget,
} from "@/lib/governance/payout"
import type { EnactmentRecord } from "@/lib/governance/scheduler"
import { useApi } from "./use-api"
import { useSpecVersion } from "./use-spec-version"

/**
 * The payout of a referendum's treasury spend_local, for `getLifecycle`:
 * `treasury.spendPeriod` (read again when the spec changes) and, once the
 * call has been enacted, where its treasury proposal stands. Null when the
 * call isn't a spend_local (`spend` null). Re-read every minute while the
 * payout is outstanding.
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

  if (!spend) return null
  return { spendPeriod, payout: payoutQuery.data ?? { status: "unknown" } }
}

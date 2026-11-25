"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import type { ClaimSpendContext, EnactmentState } from "@/lib/governance/lifecycle"
import {
  type ClaimStatus,
  readTreasurySpends,
  resolveClaim,
  type SpendTarget,
} from "@/lib/governance/payout"
import type { EnactmentRecord } from "@/lib/governance/scheduler"
import { useApi } from "./use-api"

/**
 * Where the payout of a referendum's `treasury.spend` stands, for
 * `getLifecycle`: once the call has been enacted, its entry in
 * `treasury.spends` (open until it expires, paid once the payout has been
 * attempted). Null when the call isn't a `treasury.spend` (`spend` null).
 * Re-read every minute while it is open, so the page notices it was paid or
 * expired.
 */
export function useSpendClaim(
  referendumIndex: number,
  spend: SpendTarget | null,
  enactment: { state: EnactmentState | undefined; record: EnactmentRecord | null | undefined },
  chain?: ChainConfig,
): ClaimSpendContext | null {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const api = apiQuery.data

  // Wait for the archive record (or its failure) so the spend index it names
  // is used rather than a beneficiary-and-amount match.
  const enacted = enactment.state?.status === "executed" && enactment.record !== undefined
  const record = enactment.record ?? null
  const query = useQuery<ClaimStatus>({
    queryKey: [
      "spend-claim",
      target.id,
      referendumIndex,
      spend?.beneficiary ?? null,
      spend?.amount.toString() ?? null,
      record?.block ?? null,
    ],
    queryFn: async () => {
      if (!api || !spend) throw new Error("API not ready")
      const [spends, head] = await Promise.all([readTreasurySpends(api), api.rpc.chain.getHeader()])
      const currentBlock = (head.number as unknown as { toNumber: () => number }).toNumber()
      return resolveClaim({ record, spend, spends, currentBlock })
    },
    enabled: apiQuery.isSuccess && spend != null && enacted,
    staleTime: 30_000,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      return status === "paid" || status === "expired" || status === "closed" || status === "none"
        ? false
        : 60_000
    },
  })

  if (!spend) return null
  return { claim: query.data ?? { status: "unknown" } }
}

"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  feeAllowance,
  knownPreimageRate,
  readExistentialDeposit,
  readPreimageDepositRate,
  readSubmissionDeposit,
  type PreimageDepositRate,
} from "@/lib/governance/filing-deposits"
import { useApi } from "./use-api"

type FilingCosts = {
  /** `referenda.submissionDeposit`; null while connecting. */
  submissionDeposit: bigint | null
  /** `balances.existentialDeposit`, which must stay free; 0 when unknown. */
  existentialDeposit: bigint
  /**
   * The preimage deposit rate: the app's table for this spec until the
   * chain has been asked (see readPreimageDepositRate); null while connecting.
   */
  preimageRate: PreimageDepositRate | null
  feeAllowance: bigint
}

/**
 * The chain-side inputs to filingRequirement for the connected runtime. The
 * preimage rate is read once per runtime spec.
 */
export function useFilingCosts(chain?: ChainConfig): FilingCosts {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const api = apiQuery.data
  const specVersion = api?.runtimeVersion.specVersion.toNumber() ?? null
  const rateQuery = useQuery<PreimageDepositRate>({
    queryKey: ["preimage-deposit-rate", target.id, specVersion],
    queryFn: () => {
      if (!api) throw new Error("API not ready")
      return readPreimageDepositRate(api, target.treasuryAddress)
    },
    enabled: !!api,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  return useMemo(
    () => ({
      submissionDeposit: api ? readSubmissionDeposit(api) : null,
      existentialDeposit: (api ? readExistentialDeposit(api) : null) ?? 0n,
      preimageRate:
        rateQuery.data ?? (specVersion != null ? knownPreimageRate(specVersion) : null),
      feeAllowance: feeAllowance(target.decimals),
    }),
    [api, rateQuery.data, specVersion, target.decimals],
  )
}

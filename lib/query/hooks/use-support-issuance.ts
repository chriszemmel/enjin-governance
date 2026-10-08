"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  type SupportBasis,
  supportBasisForSpec,
  supportDenominator,
} from "@/lib/governance/support"
import { useApi } from "./use-api"
import { useSpecVersion } from "./use-spec-version"

type SupportIssuance = {
  /** What `tally.support` is divided by on this runtime (planck). */
  denominator: bigint
  basis: SupportBasis
  specVersion: number
}

/**
 * The issuance the connected runtime measures referendum support against:
 * active issuance (total - inactive) before spec 1080, total issuance from
 * it (see lib/governance/support.ts). Keyed on the spec version, so a
 * runtime upgrade switches the denominator in an open tab. Issuance drifts
 * only slowly (staking rewards, fees), so a 60s stale window is plenty.
 */
export function useSupportIssuance(chain?: ChainConfig) {
  const active = useActiveChain()
  const target = chain ?? active
  const apiQuery = useApi(target)
  const specVersion = useSpecVersion(target)
  return useQuery<SupportIssuance>({
    queryKey: ["support-issuance", target.id, specVersion],
    queryFn: async () => {
      const api = apiQuery.data
      if (!api || specVersion == null) throw new Error("API not ready")
      const balances = api.query.balances
      const [total, inactive] = await Promise.all([
        balances.totalIssuance(),
        // Every runtime this app targets has it; one without it has nothing
        // inactive, so its active issuance is the total.
        balances.inactiveIssuance ? balances.inactiveIssuance() : null,
      ])
      return {
        denominator: supportDenominator(specVersion, toBigInt(total), toBigInt(inactive)),
        basis: supportBasisForSpec(specVersion),
        specVersion,
      }
    },
    enabled: apiQuery.isSuccess && specVersion != null,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

function toBigInt(codec: unknown): bigint {
  if (codec == null) return 0n
  return (codec as { toBigInt: () => bigint }).toBigInt()
}

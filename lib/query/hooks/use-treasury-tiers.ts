"use client"

import type { ChainConfig } from "@/lib/chain/chains"
import { treasuryTiersForSpec, type TreasuryTierTable } from "@/lib/governance/treasury"
import { useApi } from "./use-api"

/**
 * The treasury tier table for the connected runtime (`treasuryTiersForSpec`).
 * `specVersion` is null until the API connects. `table` is null then too, and
 * when the runtime predates every listed spec - its limits are unknown, so
 * callers must not file a spend. `notice` explains that case and the
 * unverified one (a spec missing from the list), for display.
 */
export function useTreasuryTiers(chain?: ChainConfig) {
  const apiQuery = useApi(chain)
  // Read on every render rather than memoized on the ApiPromise: polkadot.js
  // updates runtimeVersion in place on a runtime upgrade.
  const specVersion = apiQuery.data?.runtimeVersion.specVersion.toNumber() ?? null
  const table = specVersion != null ? treasuryTiersForSpec(specVersion) : null
  return { specVersion, table, notice: tierTableNotice(specVersion, table) }
}

function tierTableNotice(
  specVersion: number | null,
  table: TreasuryTierTable | null,
): string | null {
  if (specVersion == null) return null
  if (!table) {
    return `This app has no treasury spend limits for runtime spec ${specVersion}, so it can't file a spend on this chain.`
  }
  if (!table.verified) {
    return `This app has no treasury spend limits for runtime spec ${specVersion}, so it uses spec ${table.limitsSpecVersion}'s. If that upgrade lowered a limit, a spend can fail at enactment.`
  }
  return null
}

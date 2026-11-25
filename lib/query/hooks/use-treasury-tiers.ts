"use client"

import type { ChainConfig } from "@/lib/chain/chains"
import { treasuryTiersForSpec, type TreasuryTierTable } from "@/lib/governance/treasury"
import { useSpecVersion } from "./use-spec-version"

/**
 * The treasury tier table for the connected runtime (`treasuryTiersForSpec`).
 * `specVersion` is null until the API connects. `table` is null then too, and
 * when the runtime predates every listed spec - its limits are unknown, so
 * callers must not file a spend. `notice` explains that case, for display.
 * A spec missing from the list (newer than every entry) is not shown to the
 * user: the table still holds every origin to the lowest known limit, and
 * `fork/spend-limits.fork.ts` is what catches an upgrade that changes them.
 */
export function useTreasuryTiers(chain?: ChainConfig) {
  // Polled from the ApiPromise (useSpecVersion): polkadot.js updates
  // runtimeVersion in place on a runtime upgrade, and the poll re-renders
  // with the new spec's table. The tables are cached per spec.
  const specVersion = useSpecVersion(chain)
  const table = specVersion != null ? treasuryTiersForSpec(specVersion) : null
  return { specVersion, table, notice: tierTableNotice(specVersion, table) }
}

export function tierTableNotice(
  specVersion: number | null,
  table: TreasuryTierTable | null,
): string | null {
  if (specVersion == null) return null
  if (!table) {
    return `This app has no treasury spend limits for runtime spec ${specVersion}, so it can't file a spend on this chain.`
  }
  return null
}

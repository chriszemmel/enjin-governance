/**
 * Which referendum pages exist on the default network, for the sitemap.
 *
 * Two sources, each optional and time-boxed: the chain's
 * `referenda.referendumCount` (every index below it has a page) and the
 * database rows of proposals published through this site (which add the
 * date their text last changed). Neither can fail the caller - a source that
 * errors or is too slow is left out, and with neither the list is empty.
 */

import "server-only"
import { getApi } from "@/lib/chain/api"
import type { ChainConfig } from "@/lib/chain/chains"
import { isDbConfigured } from "@/lib/db/client"
import { listProposalsWithIndex } from "@/lib/db/proposals"
import { getReferendumCount } from "@/lib/governance/referenda"
import { withDeadline } from "./deadline"

const DB_READ_BUDGET_MS = 3_000
export const CHAIN_READ_BUDGET_MS = 5_000
/** Far above Enjin's referendum count; bounds a nonsense chain answer. */
const MAX_REFERENDA = 20_000

type ReferendumEntry = {
  index: number
  /** Last change of the published text or its flags; null when only the chain knows it. */
  lastModified: Date | null
}

/** Newest first. */
export async function listPublicReferenda(chain: ChainConfig): Promise<ReferendumEntry[]> {
  const [count, rows] = await Promise.all([readCount(chain), readRows(chain)])

  const entries = new Map<number, Date | null>()
  if (count != null) {
    for (let i = count - 1; i >= Math.max(0, count - MAX_REFERENDA); i--) entries.set(i, null)
  }
  for (const row of rows) {
    const index = row.referendum_index
    if (index == null || row.status !== "on_chain") continue
    // A row pointing past the chain's count doesn't have a page yet.
    if (count != null && index >= count) continue
    entries.set(index, row.updated_at ?? null)
  }
  return [...entries]
    .map(([index, lastModified]) => ({ index, lastModified }))
    .sort((a, b) => b.index - a.index)
    .slice(0, MAX_REFERENDA)
}

async function readCount(chain: ChainConfig): Promise<number | null> {
  try {
    // retries = 0, like the other server reads: the next revalidation retries.
    const count = await withDeadline(
      getApi(chain.rpc, 0).then((api) => getReferendumCount(api)),
      CHAIN_READ_BUDGET_MS,
    )
    return Number.isSafeInteger(count) && count >= 0 ? count : null
  } catch {
    return null
  }
}

async function readRows(chain: ChainConfig) {
  if (!isDbConfigured()) return []
  try {
    return await withDeadline(listProposalsWithIndex(chain.id), DB_READ_BUDGET_MS)
  } catch {
    return []
  }
}

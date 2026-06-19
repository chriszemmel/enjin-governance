/**
 * Server-side Subscan API wrapper, called from /app/api/subscan/* routes.
 *
 * We never hit Subscan directly from the browser:
 *   - CORS is restrictive on Subscan's API origin.
 *   - The API key (when configured) is a server secret.
 *
 * `SUBSCAN_API_KEY` is optional; without it most endpoints work with
 * tight rate limits, which is fine for fallback enrichment of one
 * referendum at a time.
 */

import type { ChainId } from "@/lib/chain/chains"
import { env } from "@/lib/env"

const API_BASE: Partial<Record<ChainId, string>> = {
  "enjin-relay": "https://enjin.api.subscan.io",
  "enjin-matrix": "https://matrix.api.subscan.io",
}

export type SubscanCallParam = {
  name?: string
  type?: string
  value?: unknown
}

export type SubscanReferendumData = {
  referendum_index?: number
  track?: number
  origins?: string
  status?: string
  ayes_amount?: string
  nays_amount?: string
  support_amount?: string
  submitted_block?: number
  submitted_block_timestamp?: number
  decided_block?: number
  decided_block_timestamp?: number
  proposer?: string | { address?: string }
  /**
   * Subscan returns the decoded call inline on `pre_image` (call_module,
   * call_name, params as a JSON string). We also accept the nested
   * `proposed_call` shape from older responses.
   */
  pre_image?: {
    hash?: string
    len?: number
    call_module?: string
    call_name?: string
    /** JSON-encoded string of SubscanCallParam[] in current responses. */
    params?: string | SubscanCallParam[]
    proposed_call?: {
      call_module?: string
      call_name?: string
      params?: SubscanCallParam[]
    }
  }
}

/**
 * Coerce Subscan's variable response shapes into a consistent decoded
 * call. Subscan currently returns the decoded call inline on the
 * referendum's `pre_image`, with `params` as a JSON-encoded string.
 * Older responses nest the call under `proposed_call` with a parsed
 * `params` array. Preimage-by-hash responses use the inline shape too.
 */
type NormalisedSubscanCall = {
  call_module: string
  call_name: string
  params: SubscanCallParam[]
}

export function normaliseSubscanCall(
  source:
    | {
        call_module?: string
        call_name?: string
        params?: string | SubscanCallParam[]
        proposed_call?: {
          call_module?: string
          call_name?: string
          params?: SubscanCallParam[]
        }
      }
    | null
    | undefined,
): NormalisedSubscanCall | null {
  if (!source) return null
  const nested = source.proposed_call
  const call_module = nested?.call_module ?? source.call_module
  const call_name = nested?.call_name ?? source.call_name
  if (!call_module || !call_name) return null
  let params: SubscanCallParam[] = []
  if (Array.isArray(nested?.params)) {
    params = nested.params
  } else if (Array.isArray(source.params)) {
    params = source.params
  } else if (typeof source.params === "string" && source.params.trim().length) {
    try {
      const parsed = JSON.parse(source.params)
      if (Array.isArray(parsed)) params = parsed as SubscanCallParam[]
    } catch {
      // Bad JSON - fall through with empty params.
    }
  }
  return { call_module, call_name, params }
}

export async function fetchSubscanReferendum(
  chainId: ChainId,
  index: number,
): Promise<SubscanReferendumData | null> {
  const base = API_BASE[chainId]
  if (!base) {
    return null
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (env.SUBSCAN_API_KEY) headers["X-API-Key"] = env.SUBSCAN_API_KEY

  try {
    const res = await fetch(`${base}/api/scan/referenda/referendum`, {
      method: "POST",
      headers,
      body: JSON.stringify({ referendum_index: index }),
      cache: "no-store",
    })
    if (!res.ok) {
      return null
    }
    const body = (await res.json()) as { code: number; message?: string; data?: SubscanReferendumData }
    if (body.code !== 0) {
      return null
    }
    return body.data ?? null
  } catch {
    return null
  }
}

/**
 * Subscan's preimage endpoint returns decoded call data even when the
 * on-chain `preimage.preimageFor` map has been pruned. The shape varies a
 * bit across Subscan v1/v2 - sometimes the call lives under
 * `proposed_call`, sometimes at the top level. We expose both fallbacks
 * so the route handler can pick whichever is populated.
 */
export type SubscanPreimageData = {
  hash?: string
  length?: number
  status?: string
  call_module?: string
  call_name?: string
  params?: SubscanCallParam[]
  proposed_call?: {
    call_module?: string
    call_name?: string
    params?: SubscanCallParam[]
  }
}

export async function fetchSubscanPreimage(
  chainId: ChainId,
  hash: string,
): Promise<SubscanPreimageData | null> {
  const base = API_BASE[chainId]
  if (!base) {
    return null
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (env.SUBSCAN_API_KEY) headers["X-API-Key"] = env.SUBSCAN_API_KEY

  try {
    const res = await fetch(`${base}/api/scan/referenda/preimage`, {
      method: "POST",
      headers,
      body: JSON.stringify({ hash }),
      cache: "no-store",
    })
    if (!res.ok) {
      return null
    }
    const body = (await res.json()) as {
      code: number
      message?: string
      data?: SubscanPreimageData
    }
    if (body.code !== 0) {
      return null
    }
    return body.data ?? null
  } catch {
    return null
  }
}

/**
 * Raw shape we get back from Subscan's referenda/votes endpoint. Fields are
 * marked optional because the free tier sometimes omits them and v1 vs. v2
 * column names vary. The route handler normalises this for the UI.
 */
type SubscanVoteRaw = {
  account?: { address?: string; display?: string } | string
  voter?: string
  block_num?: number
  block_timestamp?: number
  extrinsic_index?: string
  /** Some endpoints flatten the AccountVote into the row. */
  vote?: unknown
  conviction?: number | string
  amount?: string
  balance?: string
  vote_balance?: string
  /** Enjin's voteManager carries this; missing on stock convictionVoting. */
  currency?: unknown
  status?: string
}

type SubscanVote = {
  voter: string
  blockNumber: number | null
  timestamp: number | null
  extrinsicIndex: string | null
  /** Raw bytes balance; the UI converts via formatTokenAmount. */
  balance: bigint
  /** Numeric byte (0..6 conviction, 0x80 = aye flag) when we can recover it. */
  voteRaw: unknown
  /** Separate conviction value when Subscan splits it off the vote byte. */
  convictionRaw: unknown
  currencyRaw: unknown
}

function pickVoter(row: SubscanVoteRaw): string | null {
  if (typeof row.voter === "string") return row.voter
  if (typeof row.account === "string") return row.account
  if (row.account && typeof row.account === "object") {
    return row.account.address ?? null
  }
  return null
}

function pickBalance(row: SubscanVoteRaw): bigint {
  const candidates = [row.amount, row.balance, row.vote_balance]
  for (const c of candidates) {
    if (typeof c === "string" && /^\d+$/.test(c)) return BigInt(c)
  }
  if (typeof row.vote === "object" && row.vote !== null) {
    const v = row.vote as Record<string, unknown>
    if (typeof v.balance === "string" && /^\d+$/.test(v.balance)) {
      return BigInt(v.balance)
    }
  }
  return 0n
}

export async function fetchSubscanVotes(
  chainId: ChainId,
  index: number,
  pageRow = 100,
): Promise<SubscanVote[] | null> {
  const base = API_BASE[chainId]
  if (!base) {
    return null
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (env.SUBSCAN_API_KEY) headers["X-API-Key"] = env.SUBSCAN_API_KEY

  try {
    const res = await fetch(`${base}/api/scan/referenda/votes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ referendum_index: index, row: pageRow, page: 0 }),
      cache: "no-store",
    })
    if (!res.ok) {
      return null
    }
    const body = (await res.json()) as {
      code: number
      message?: string
      data?: {
        list?: SubscanVoteRaw[]
        // Subscan sometimes uses these field names instead of `list`:
        records?: SubscanVoteRaw[]
        votes?: SubscanVoteRaw[]
        count?: number
      } & Record<string, unknown>
    }
    if (body.code !== 0) {
      return null
    }
    const list =
      body.data?.list ??
      body.data?.records ??
      body.data?.votes ??
      // Last resort: pick the first array-typed field.
      (body.data
        ? (Object.values(body.data).find((v) => Array.isArray(v)) as
            | SubscanVoteRaw[]
            | undefined) ?? []
        : [])
    return list.map((row) => ({
      voter: pickVoter(row) ?? "",
      blockNumber: row.block_num ?? null,
      timestamp: row.block_timestamp ?? null,
      extrinsicIndex: row.extrinsic_index ?? null,
      balance: pickBalance(row),
      voteRaw: row.vote ?? row.status,
      convictionRaw: row.conviction,
      currencyRaw: row.currency,
    }))
  } catch {
    return null
  }
}

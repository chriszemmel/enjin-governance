/**
 * Helpers around the `nominationPools` pallet and Enjin's sENJ
 * multi-token family.
 *
 * sENJ lives in the `multiTokens` pallet under the chain's
 * sEnjCollectionId, with tokenId === poolId. A user holding sENJ for
 * pool N has a non-zero `tokenAccounts(collection, N, account).balance`.
 *
 * sENJ accrues rewards, so 1 sENJ is worth slightly more than 1 ENJ.
 * The per-pool stake factor is:
 *   stakeFactor = pool_active_balance / sENJ_total_supply
 *   realEnj     = senjBalance * stakeFactor
 *
 * `pool_active_balance` comes from `staking.ledger(<pool stash>).active`
 * - the stash account is deterministically derived from the pool id and
 * the `nominationPools.palletId` constant.
 */

import type { ApiPromise } from "@polkadot/api"
import { BN, bnToU8a, stringToU8a, u8aConcat } from "@polkadot/util"

export type PoolInfo = {
  poolId: number
  /** UTF-8 decoded name, or null when the pool has none on chain. */
  name: string | null
  /** Pool state - Open / Blocked / Destroying. Free-form to stay forward-compatible. */
  state: string
  /** multiTokens token id of the pool's representative art NFT (Degens family). */
  tokenId: bigint
}

/**
 * Read pool `id` from `nominationPools.bondedPools`. Returns null when
 * the pallet isn't present, the pool doesn't exist, or its on-chain
 * record lacks a `tokenId` (older runtimes without NFT-backed pools).
 */
export async function getPool(
  api: ApiPromise,
  id: number,
): Promise<PoolInfo | null> {
  const q = api.query.nominationPools?.bondedPools
  if (!q) return null

  const raw = await q(id)
  const parsed = (raw as { toJSON?: () => unknown } | null | undefined)?.toJSON?.()
  if (parsed == null || typeof parsed !== "object") return null

  const obj = parsed as Record<string, unknown>
  const tokenIdRaw = obj.tokenId
  if (tokenIdRaw == null) return null

  return {
    poolId: id,
    name: decodePoolName(obj.name),
    state: typeof obj.state === "string" ? obj.state : "Unknown",
    tokenId: BigInt(asNumericString(tokenIdRaw)),
  }
}

/**
 * Pool names are encoded as either an array of u8 (bytes), a `0x…` hex
 * string, or null. Normalise all three to UTF-8 - returns null when no
 * usable name exists.
 */
function decodePoolName(raw: unknown): string | null {
  if (raw == null) return null
  let bytes: Uint8Array
  if (typeof raw === "string") {
    if (!raw.startsWith("0x")) return raw || null
    const hex = raw.slice(2)
    const parts = hex.match(/.{1,2}/g) ?? []
    bytes = new Uint8Array(parts.map((b) => parseInt(b, 16)))
  } else if (Array.isArray(raw)) {
    bytes = new Uint8Array(raw as number[])
  } else {
    return null
  }
  if (bytes.length === 0) return null
  try {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

/**
 * Polkadot.js sometimes hands back numbers like `"2,500,000"` (compact
 * string with separators) for u128 fields when `toJSON` is called.
 * Strip non-digits before BigInt-ing.
 */
function asNumericString(x: unknown): string {
  if (typeof x === "number") return String(x)
  if (typeof x === "bigint") return x.toString()
  const s = String(x)
  if (s.startsWith("0x")) return BigInt(s).toString()
  return s.replace(/[^0-9]/g, "") || "0"
}

export type StakedEnjHolding = {
  poolId: number
  /** Pool name from chain state, or null. */
  poolName: string | null
  /** User's sENJ balance for this pool (raw planck units). */
  senjBalance: bigint
  /**
   * ENJ-equivalent of `senjBalance` at the current stake rate. sENJ
   * accrues staking rewards, so 1 sENJ ≥ 1 ENJ; this is what voters
   * actually contribute to the tally in ENJ terms.
   */
  realEnjBalance: bigint
  /**
   * Numerator / denominator of the per-pool stake factor - kept in
   * BigInts to preserve precision. UI multiplies amounts by this
   * ratio for ENJ-equivalent display.
   */
  stakeFactorNum: bigint
  stakeFactorDen: bigint
}

/**
 * Derive a pool's stash account (AccountId32) the same way
 * `nominationPools::Pallet::create_bonded_account` does on chain:
 *
 *   b"modl" ++ palletId(8B) ++ 0x01 ++ poolId(u32 LE, 4B) ++ pad(...)
 *
 * The result is 32 bytes; we let the runtime registry turn it into an
 * SS58 string. Stash is the "account 1" sub-account of the pool
 * (vs the reward account, which uses 0x00).
 */
function poolStashAccount(api: ApiPromise, poolId: number): string {
  const palletId = (
    api.consts.nominationPools.palletId as unknown as { toU8a: () => Uint8Array }
  ).toU8a()
  // 32-byte AccountId: "modl"(4) + palletId(8) + marker(1) + poolId(4 LE) + pad(15)
  const head = u8aConcat(
    stringToU8a("modl"),
    palletId,
    new Uint8Array([1]),
    bnToU8a(new BN(poolId), { bitLength: 32, isLe: true }),
  )
  const pad = new Uint8Array(32 - head.length)
  return api.registry
    .createType("AccountId32", u8aConcat(head, pad))
    .toString()
}

/**
 * Every nomination pool the user holds sENJ in. For each pool we:
 *
 *   1. Read `multiTokens.tokenAccounts(collectionId, poolId, account)`
 *      to get the user's sENJ balance.
 *   2. Skip pools where the balance is zero.
 *   3. Read `multiTokens.tokens(collectionId, poolId).supply` and
 *      `staking.ledger(<pool stash>).active` to compute the stake
 *      factor for display.
 *
 * Returns an empty array when:
 *   - the runtime doesn't expose `multiTokens`,
 *   - no sEnjCollectionId is configured (canary / matrix),
 *   - the address holds no sENJ.
 *
 * Per-pool failures are swallowed so a single bad pool can't sink
 * the rest of the list.
 */
export async function getStakedEnjBalances(
  api: ApiPromise,
  address: string,
  sEnjCollectionId: bigint,
): Promise<StakedEnjHolding[]> {
  if (!api.query.multiTokens?.tokenAccounts) return []
  if (!api.query.nominationPools?.bondedPools) return []

  const entries = await api.query.nominationPools.bondedPools.entries()
  const poolIds: number[] = entries
    .map(([key]) => {
      const idCodec = key.args[0] as unknown as { toNumber: () => number }
      return idCodec.toNumber()
    })
    .filter((id) => Number.isFinite(id))

  const results = await Promise.all(
    poolIds.map(async (poolId): Promise<StakedEnjHolding | null> => {
      try {
        const [accountRaw, supplyRaw, ledgerRaw, poolMeta] = await Promise.all([
          api.query.multiTokens.tokenAccounts(
            sEnjCollectionId.toString(),
            poolId,
            address,
          ),
          api.query.multiTokens.tokens(sEnjCollectionId.toString(), poolId),
          readStakingActive(api, poolId),
          getPool(api, poolId),
        ])

        const accountParsed = (accountRaw as { toJSON?: () => unknown } | null)
          ?.toJSON?.()
        if (accountParsed == null || typeof accountParsed !== "object") return null
        const senjBalance = BigInt(
          asNumericString((accountParsed as Record<string, unknown>).balance ?? 0),
        )
        if (senjBalance <= 0n) return null

        const supplyParsed = (supplyRaw as { toJSON?: () => unknown } | null)
          ?.toJSON?.()
        const supply =
          supplyParsed && typeof supplyParsed === "object"
            ? BigInt(
                asNumericString(
                  (supplyParsed as Record<string, unknown>).supply ?? 0,
                ),
              )
            : 0n

        const active = ledgerRaw
        const num = supply > 0n ? active : 1n
        const den = supply > 0n ? supply : 1n
        const realEnjBalance =
          supply > 0n && active > 0n ? (senjBalance * active) / supply : senjBalance

        return {
          poolId,
          poolName: poolMeta?.name ?? null,
          senjBalance,
          realEnjBalance,
          stakeFactorNum: num,
          stakeFactorDen: den,
        }
      } catch {
        return null
      }
    }),
  )

  return results
    .filter((h): h is StakedEnjHolding => h != null)
    .sort((a, b) => Number(b.realEnjBalance - a.realEnjBalance))
}

/**
 * Read the active bonded balance backing a pool by deriving the stash
 * account and looking up `staking.ledger(<stash>).active`. Returns 0n
 * when the ledger doesn't exist (rare - pool stake is never zero in
 * practice, but defensive).
 */
async function readStakingActive(api: ApiPromise, poolId: number): Promise<bigint> {
  if (!api.query.staking?.ledger || !api.consts.nominationPools?.palletId) {
    return 0n
  }
  try {
    const stash = poolStashAccount(api, poolId)
    const raw = await api.query.staking.ledger(stash)
    const parsed = (raw as { toJSON?: () => unknown } | null)?.toJSON?.()
    if (parsed == null || typeof parsed !== "object") return 0n
    const active = (parsed as Record<string, unknown>).active
    if (active == null) return 0n
    return BigInt(asNumericString(active))
  } catch {
    return 0n
  }
}

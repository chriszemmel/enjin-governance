/**
 * User row CRUD. Auto-creates a row on first wallet sighting so the
 * rest of the app can always resolve `address → user_id` synchronously.
 *
 * Each SS58 address is its own user row, scoped to a single network
 * via the `network` column derived from the SS58 prefix. The same key
 * on Enjin Relay (en…) and Canary (cn…) intentionally produces two
 * separate users so handles can be claimed independently per network
 * - see scripts/009_users_per_network_handle.sql.
 */

import "server-only"
import { networkOfAddress } from "@/lib/auth/sign-in-network"
import { getSql } from "./client"

export type UserRow = {
  id: string
  address: string
  network: string | null
  handle: string | null
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  avatar_key: string | null
  avatar_updated_at: Date | null
  created_at: Date
  updated_at: Date
}

/**
 * Get-or-create. Idempotent - concurrent inserts with the same address
 * collapse to one row via the UNIQUE constraint and `ON CONFLICT DO NOTHING`.
 *
 * The `network` comes from the address's exact SS58 prefix. An address in
 * no known network's format (a generic 5… one, a raw key) throws instead
 * of making a row without one, which the per-network handle UNIQUE
 * wouldn't cover. Sign-in refuses those formats before it gets here.
 */
export async function upsertUserByAddress(address: string): Promise<UserRow> {
  const network = networkOfAddress(address)
  if (!network) {
    throw new Error(`No known network uses the address format of ${address}`)
  }
  const sql = getSql()
  const rows = (await sql`
    WITH ins AS (
      INSERT INTO users (address, network)
      VALUES (${address}, ${network})
      ON CONFLICT (address) DO NOTHING
      RETURNING *
    )
    SELECT * FROM ins
    UNION ALL
    SELECT * FROM users WHERE address = ${address}
    LIMIT 1
  `) as UserRow[]
  if (rows.length === 0) {
    throw new Error(`Failed to upsert user for address ${address}`)
  }
  return rows[0]
}

export async function getUserByAddress(address: string): Promise<UserRow | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT * FROM users WHERE address = ${address} LIMIT 1
  `) as UserRow[]
  return rows[0] ?? null
}

/**
 * Bulk variant for list views that would otherwise fan out into one
 * `/api/users/by-address/[addr]` request per row. Missing addresses are
 * simply absent from the result - the caller dedupes/joins on `address`.
 */
export async function getUsersByAddresses(
  addresses: ReadonlyArray<string>,
): Promise<UserRow[]> {
  if (addresses.length === 0) return []
  const sql = getSql()
  return (await sql`
    SELECT * FROM users WHERE address = ANY(${addresses as string[]})
  `) as UserRow[]
}

export type ProfileUpdate = {
  display_name?: string | null
  bio?: string | null
  handle?: string | null
}

/**
 * Update the fields present in `patch`: a field left out keeps its value,
 * a field given as null is cleared.
 */
export async function updateProfile(
  userId: string,
  patch: ProfileUpdate,
): Promise<UserRow> {
  const sql = getSql()
  const has = (field: keyof ProfileUpdate) => patch[field] !== undefined
  const rows = (await sql`
    UPDATE users SET
      display_name = CASE WHEN ${has("display_name")} THEN ${patch.display_name ?? null} ELSE display_name END,
      bio          = CASE WHEN ${has("bio")} THEN ${patch.bio ?? null} ELSE bio END,
      handle       = CASE WHEN ${has("handle")} THEN ${patch.handle ?? null} ELSE handle END
    WHERE id = ${userId}
    RETURNING *
  `) as UserRow[]
  if (rows.length === 0) throw new Error(`No user ${userId}`)
  return rows[0]
}

export async function setAvatar(
  userId: string,
  avatarUrl: string,
  avatarKey: string,
): Promise<void> {
  const sql = getSql()
  await sql`
    UPDATE users
       SET avatar_url = ${avatarUrl},
           avatar_key = ${avatarKey},
           avatar_updated_at = NOW()
     WHERE id = ${userId}
  `
}

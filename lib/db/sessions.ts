/**
 * wallet_sessions CRUD. The auth flow stores the sha256 of the bearer
 * token so the raw secret never lives in the DB. Sessions auto-expire
 * via the `expires_at` column.
 */

import "server-only"
import { getSql } from "./client"

type SessionRow = {
  token_hash: string
  user_id: string
  address: string
  issued_at: Date
  expires_at: Date
  last_seen_at: Date
  user_agent: string | null
  ip_address: string | null
}

type InsertSession = {
  tokenHash: string
  userId: string
  address: string
  expiresAt: Date
  userAgent: string | null
  ipAddress: string | null
}

export async function insertSession(s: InsertSession): Promise<void> {
  const sql = getSql()
  await sql`
    INSERT INTO wallet_sessions (
      token_hash, user_id, address, expires_at, user_agent, ip_address
    ) VALUES (
      ${s.tokenHash}, ${s.userId}, ${s.address}, ${s.expiresAt.toISOString()}, ${s.userAgent}, ${s.ipAddress}
    )
  `
}

/** Look up an active session by the sha256 of its bearer token. */
export async function getActiveSession(
  tokenHash: string,
): Promise<SessionRow | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT * FROM wallet_sessions
    WHERE token_hash = ${tokenHash}
      AND expires_at > NOW()
    LIMIT 1
  `) as SessionRow[]
  if (rows.length === 0) return null
  // Touch last_seen_at - best effort, ignore failures.
  void sql`
    UPDATE wallet_sessions
       SET last_seen_at = NOW()
     WHERE token_hash = ${tokenHash}
  `.catch(() => {})
  return rows[0] ?? null
}

export async function deleteSession(tokenHash: string): Promise<void> {
  const sql = getSql()
  await sql`DELETE FROM wallet_sessions WHERE token_hash = ${tokenHash}`
}

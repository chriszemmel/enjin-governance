/**
 * Persisted SIWE nonces. See scripts/008_auth_nonces.sql for the
 * rationale - TL;DR Vercel function instances don't share memory, so
 * the previous in-memory Map kept losing nonces between the nonce hop
 * and the verify hop.
 */

import "server-only"
import { getSql } from "./client"

export async function insertNonce(args: {
  nonce: string
  address: string
  message: string
  expiresAt: Date
}): Promise<void> {
  const sql = getSql()
  await sql`
    INSERT INTO auth_nonces (nonce, address, message, expires_at)
    VALUES (
      ${args.nonce},
      ${args.address},
      ${args.message},
      ${args.expiresAt.toISOString()}
    )
  `
}

/**
 * Atomic consume - DELETE … RETURNING in a single statement so two
 * concurrent verifies for the same nonce can never both succeed. The
 * filter also enforces "address matches" and "not yet expired", which
 * lets us answer "is this nonce still valid for this address?" without
 * a separate SELECT.
 *
 * Returns the stored message bytes when the row existed and was still
 * valid; null otherwise. The caller treats null identically regardless
 * of reason (unknown / expired / wrong address) to avoid leaking nonce
 * lifetime details through the error path.
 */
export async function consumeNonceRow(args: {
  nonce: string
  address: string
}): Promise<{ message: string } | null> {
  const sql = getSql()
  const rows = (await sql`
    DELETE FROM auth_nonces
     WHERE nonce = ${args.nonce}
       AND address = ${args.address}
       AND expires_at > NOW()
    RETURNING message
  `) as Array<{ message: string }>
  return rows[0] ?? null
}

/**
 * Best-effort GC of expired rows. Called opportunistically from the
 * nonce-issue path; failure is non-fatal - the next insert will run
 * the GC again, and the expires_at filter on consume already prevents
 * stale rows from being honoured. Swallowing the error here keeps the
 * caller's happy path clean even if the DELETE races with a backup.
 */
export async function gcExpiredNonces(): Promise<void> {
  const sql = getSql()
  try {
    await sql`DELETE FROM auth_nonces WHERE expires_at < NOW()`
  } catch {
    /* non-fatal */
  }
}

/**
 * Neon serverless Postgres client.
 *
 * `sql` is a tagged-template function - `sql`SELECT * FROM users WHERE id = ${id}``
 * passes `id` as a parameter, not as a string-substituted SQL fragment.
 *
 * When `DATABASE_URL` is unset, callers should treat every db.* call as
 * best-effort and surface the resulting `Db unavailable` error as a 503.
 * Activity logging in particular must never crash a page.
 */

import "server-only"
import { neon, type NeonQueryFunction } from "@neondatabase/serverless"
import { env } from "@/lib/env"

let cachedSql: NeonQueryFunction<false, false> | null = null

/**
 * Lazily-built singleton. Throws when `DATABASE_URL` is unset so callers
 * can catch and degrade. The Neon driver itself is HTTP-based and stateless
 * per call, so there's no connection-pool cost to recreating the function.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (cachedSql) return cachedSql
  if (!env.DATABASE_URL) {
    throw new Error("Db unavailable: DATABASE_URL is not configured")
  }
  cachedSql = neon(env.DATABASE_URL)
  return cachedSql
}

export function isDbConfigured(): boolean {
  return Boolean(env.DATABASE_URL)
}

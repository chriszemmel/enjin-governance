/**
 * Lightweight fixed-window rate limiter.
 *
 * Puts a per-key abuse ceiling on the write + auth endpoints (sign-in nonce
 * and verify, profile edits, comments, proposal drafts and their confirm /
 * cancel / withdraw, media + avatar uploads, security disclosures, and the
 * site-access gate) so a script can't flood a table, hammer the chain RPC,
 * fill R2, or brute-force the gate password. Over-limit callers get a 429
 * with a `Retry-After` header. The full set of ceilings lives in
 * `RATE_LIMITS` below.
 *
 * Design notes:
 *   - The core (`consume`) is a pure function over an injected store + clock
 *     so it is fully unit-testable with no globals and no wall-clock.
 *   - `enforceRateLimit` uses a shared Upstash KV store when
 *     `KV_REST_API_URL` / `KV_REST_API_TOKEN` are set, so ceilings hold across
 *     serverless instances. With no KV configured (or on a transient KV
 *     error) it falls back to a per-instance in-process `Map`, which still
 *     stops the bursty abuse that matters most on a single instance. Rate
 *     limiting is therefore never disabled by a KV hiccup.
 *   - No `server-only` import: this is a pure utility importable from tests.
 */

type RateLimitResult = {
  /** True when the request is under the limit and may proceed. */
  allowed: boolean
  /** Remaining requests in the current window (0 when blocked). */
  remaining: number
  /** Epoch-ms when the current window resets. */
  resetAt: number
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfterSeconds: number
}

export type RateLimitBucket = { count: number; resetAt: number }

/**
 * Pure fixed-window check. Mutates `store` for `key`. Deterministic given
 * `now`, so tests drive it with a fixed clock.
 */
export function consume(
  store: Map<string, RateLimitBucket>,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitResult {
  const existing = store.get(key)

  // Fresh window: either never seen, or the previous window has elapsed.
  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs
    store.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: limit - 1, resetAt, retryAfterSeconds: 0 }
  }

  // Inside the window, over the limit.
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  // Inside the window, under the limit.
  existing.count += 1
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    retryAfterSeconds: 0,
  }
}

/**
 * Drop expired buckets so the in-process store can't grow without bound.
 * Cheap linear sweep, only triggered past a size threshold.
 */
export function sweepExpired(
  store: Map<string, RateLimitBucket>,
  now: number,
): void {
  for (const [key, bucket] of store) {
    if (now >= bucket.resetAt) store.delete(key)
  }
}

/** Extract the best-effort client IP from request headers. */
export function ipFromHeaders(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")
  if (fwd) {
    const first = fwd.split(",")[0]?.trim()
    if (first) return first
  }
  return headers.get("x-real-ip")?.trim() || "unknown"
}

// Module-global store for the default in-process backend.
const SWEEP_THRESHOLD = 5_000
const globalStore = new Map<string, RateLimitBucket>()

type EnforceArgs = {
  /** Logical bucket name, e.g. "auth-nonce". Namespaces the key. */
  scope: string
  /** Stable per-caller identity - a user id, or an IP for anonymous routes. */
  identity: string
  /** Max requests allowed per window. */
  limit: number
  /** Window length in ms. */
  windowMs: number
}

/**
 * Fixed-window check against a shared Upstash KV store via its REST API.
 * Returns null when KV isn't configured or the call fails, so the caller can
 * fall back to the in-process store rather than failing open.
 *
 * One pipelined round trip: `SET key 0 PX window NX` creates the window with a
 * TTL exactly once (NX = only if absent, so the TTL is never extended by later
 * hits); `INCR` counts this request; `PTTL` reads the remaining window so we
 * can report an accurate `Retry-After` / reset.
 */
async function kvConsume(args: EnforceArgs): Promise<RateLimitResult | null> {
  // Accept either naming the Vercel/Upstash integrations inject: the Vercel KV
  // (`KV_REST_API_*`) or the native Upstash (`UPSTASH_REDIS_REST_*`) form, so
  // the shared store works however KV was added.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  const now = Date.now()
  const key = `rl:${args.scope}:${args.identity}`
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["SET", key, "0", "PX", String(args.windowMs), "NX"],
        ["INCR", key],
        ["PTTL", key],
      ]),
      cache: "no-store",
    })
    if (!res.ok) return null
    const out = (await res.json()) as Array<{ result?: unknown }>
    const count = Number(out[1]?.result)
    if (!Number.isFinite(count)) return null
    let ttl = Number(out[2]?.result)
    if (!Number.isFinite(ttl) || ttl < 0) ttl = args.windowMs
    const resetAt = now + ttl
    if (count > args.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)),
      }
    }
    return {
      allowed: true,
      remaining: Math.max(0, args.limit - count),
      resetAt,
      retryAfterSeconds: 0,
    }
  } catch {
    return null
  }
}

/**
 * Enforce a limit. Prefers the shared Upstash KV store (so the ceiling holds
 * across serverless instances); falls back to the in-process store when KV is
 * unconfigured or unreachable. Returns the same shape as `consume` so the
 * caller can build a 429.
 */
export async function enforceRateLimit(
  args: EnforceArgs,
): Promise<RateLimitResult> {
  const kv = await kvConsume(args)
  if (kv) return kv

  const now = Date.now()
  if (globalStore.size > SWEEP_THRESHOLD) sweepExpired(globalStore, now)
  return consume(
    globalStore,
    `${args.scope}:${args.identity}`,
    args.limit,
    args.windowMs,
    now,
  )
}

/** Reset the in-process store. Test-only helper. */
export function __resetRateLimitStore(): void {
  globalStore.clear()
}

/**
 * Central limit table so the ceilings live in one place. Windows are
 * generous enough not to bite legitimate use, tight enough to stop a
 * burst. Authenticated routes key on the user id; the anonymous nonce
 * route keys on IP.
 */
export const RATE_LIMITS = {
  authNonce: { scope: "auth-nonce", limit: 10, windowMs: 60_000 },
  // Sign-in verification creates a session row. The nonce step already caps
  // the funnel per IP, but this is a direct ceiling on session creation so
  // the cap holds even if the nonce limit is ever loosened.
  authVerify: { scope: "auth-verify", limit: 20, windowMs: 300_000 },
  // Profile saves. Each can try a handle, so this also slows probing which
  // handles are taken.
  profileUpdate: { scope: "profile-update", limit: 20, windowMs: 600_000 },
  commentCreate: { scope: "comment-create", limit: 20, windowMs: 60_000 },
  // Every edit runs the automatic text check again.
  commentEdit: { scope: "comment-edit", limit: 10, windowMs: 300_000 },
  commentDelete: { scope: "comment-delete", limit: 20, windowMs: 60_000 },
  proposalDraft: { scope: "proposal-draft", limit: 10, windowMs: 60_000 },
  // Each confirm reads the chain. The browser retries a failed one up to
  // three times, plus once after signing in again
  // (lib/governance/confirm-client.ts), so this leaves room for several full
  // rounds - and for linking a few drafts in a row.
  proposalConfirm: { scope: "proposal-confirm", limit: 30, windowMs: 300_000 },
  proposalCancel: { scope: "proposal-cancel", limit: 20, windowMs: 300_000 },
  // Withdraw sets or clears a public banner on a live referendum.
  proposalWithdraw: { scope: "proposal-withdraw", limit: 10, windowMs: 300_000 },
  mediaUpload: { scope: "media-upload", limit: 30, windowMs: 300_000 },
  avatarUpload: { scope: "avatar-upload", limit: 10, windowMs: 300_000 },
  // Reports are cheap to send and each lands in a human queue.
  moderationReport: { scope: "moderation-report", limit: 10, windowMs: 600_000 },
  moderationAction: { scope: "moderation-action", limit: 60, windowMs: 60_000 },
  // Telegram notices about new reports, across all users: a flood of
  // reports must not flood the moderators' chat.
  moderationNotice: { scope: "moderation-notice", limit: 20, windowMs: 3_600_000 },
  // Public, unauthenticated - keyed on IP. A handful per 10 min is plenty for
  // a genuine reporter while stopping a flood of the disclosures table.
  securityDisclosure: { scope: "security-disclosure", limit: 5, windowMs: 600_000 },
  // Site-access password gate. A password check with no ceiling is a
  // brute-force target, so cap attempts per IP - loose enough for a genuine
  // user who mistypes, tight enough that guessing the password is infeasible.
  siteUnlock: { scope: "site-unlock", limit: 10, windowMs: 300_000 },
} as const

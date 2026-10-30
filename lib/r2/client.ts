/**
 * Cloudflare R2 client. R2 is S3-compatible, so we drive it with
 * @aws-sdk/client-s3 pointed at the R2 endpoint.
 *
 * Calls fail loudly if R2 env vars are unset - the proposal-create
 * flow is unusable without R2, so there's no graceful-degrade path
 * worth keeping (unlike the optional DB).
 */

import "server-only"
import { S3Client } from "@aws-sdk/client-s3"
import { env } from "@/lib/env"

let cachedClient: S3Client | null = null

export function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_ENDPOINT &&
      env.R2_PUBLIC_URL,
  )
}

export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient
  if (
    !env.R2_ENDPOINT ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error("R2 unavailable: R2_* env vars are not configured")
  }
  cachedClient = new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  })
  return cachedClient
}

export function r2Bucket(): string {
  return env.R2_BUCKET
}

export function r2PublicBase(): string {
  if (!env.R2_PUBLIC_URL) {
    throw new Error("R2 unavailable: R2_PUBLIC_URL is not configured")
  }
  return env.R2_PUBLIC_URL
}

/** What a route should answer (503) while `isPublicUrlMisconfigured()`. */
export const PUBLIC_URL_NOT_CONFIGURED = "The site's public URL isn't configured."

export class PublicUrlNotConfiguredError extends Error {
  constructor() {
    super(PUBLIC_URL_NOT_CONFIGURED)
    this.name = "PublicUrlNotConfiguredError"
  }
}

function isLocalOrigin(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "")
  } catch {
    return true
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host)
  )
}

/**
 * True on the production deployment (VERCEL_ENV=production) when
 * NEXT_PUBLIC_APP_URL still points at this machine - usually because it was
 * never set and fell back to http://localhost:3000. URLs built from it would
 * be pinned on chain in EGOV1 records and never resolve, so
 * `publicAssetBase` refuses to build them. Local dev, tests and preview
 * deployments are never flagged. Also for the admin status page.
 */
export function isPublicUrlMisconfigured(): boolean {
  return process.env.VERCEL_ENV === "production" && isLocalOrigin(env.NEXT_PUBLIC_APP_URL)
}

/**
 * Base for the URLs we hand out (and pin on chain in the EGOV1 remark).
 *
 * Public reads are served from the app's own `/r` route on its canonical
 * origin, not the bucket's `r2.dev` URL. That keeps the on-chain proposal
 * pointer on a durable, official domain, decoupled from where R2 actually
 * lives, and off the rate-limited public dev URL. Falls back to the raw
 * bucket URL only if no app origin is configured.
 *
 * Throws PublicUrlNotConfiguredError while `isPublicUrlMisconfigured()`:
 * routes that build these URLs should check that first and answer 503
 * with PUBLIC_URL_NOT_CONFIGURED.
 */
export function publicAssetBase(): string {
  if (isPublicUrlMisconfigured()) throw new PublicUrlNotConfiguredError()
  const appOrigin = env.NEXT_PUBLIC_APP_URL
  if (appOrigin) {
    return `${appOrigin.replace(/\/+$/, "")}/r`
  }
  return r2PublicBase()
}

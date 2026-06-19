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

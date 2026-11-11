/**
 * The public URL guard: a production deploy that forgot NEXT_PUBLIC_APP_URL
 * (it defaults to http://localhost:3000) must not build - and pin on chain -
 * localhost URLs. Local dev, tests and preview deployments are left alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cfg = vi.hoisted(() => ({
  env: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
    R2_PUBLIC_URL: "https://pub.r2.dev",
    R2_BUCKET: "enjin-governance",
  } as Record<string, string | undefined>,
  sent: [] as unknown[],
}))

vi.mock("@/lib/env", () => ({ env: cfg.env }))
vi.mock("@aws-sdk/client-s3", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  S3Client: class {
    async send(command: unknown) {
      cfg.sent.push(command)
      return {}
    }
  },
}))

import {
  isPublicUrlMisconfigured,
  PUBLIC_URL_NOT_CONFIGURED,
  PublicUrlNotConfiguredError,
  publicAssetBase,
} from "@/lib/r2/client"
import { putObject } from "@/lib/r2/upload"

beforeEach(() => {
  cfg.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"
  cfg.sent.length = 0
  vi.stubEnv("VERCEL_ENV", "")
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("isPublicUrlMisconfigured / publicAssetBase", () => {
  it("leaves local dev, tests and preview deployments on localhost alone", () => {
    for (const vercelEnv of ["", "development", "preview"]) {
      vi.stubEnv("VERCEL_ENV", vercelEnv)
      expect(isPublicUrlMisconfigured(), vercelEnv).toBe(false)
      expect(publicAssetBase()).toBe("http://localhost:3000/r")
    }
  })

  it("flags a localhost public URL in production and refuses to build URLs on it", () => {
    vi.stubEnv("VERCEL_ENV", "production")
    for (const url of [
      "http://localhost:3000",
      "https://localhost",
      "http://127.0.0.1:3000/",
      "http://[::1]:3000",
      "http://0.0.0.0:3000",
      "http://gov.localhost:3000",
    ]) {
      cfg.env.NEXT_PUBLIC_APP_URL = url
      expect(isPublicUrlMisconfigured(), url).toBe(true)
      expect(() => publicAssetBase(), url).toThrow(PublicUrlNotConfiguredError)
      expect(() => publicAssetBase(), url).toThrow(PUBLIC_URL_NOT_CONFIGURED)
    }
    expect(PUBLIC_URL_NOT_CONFIGURED).toBe("The site's public URL isn't configured.")
  })

  it("uses the configured origin in production", () => {
    vi.stubEnv("VERCEL_ENV", "production")
    cfg.env.NEXT_PUBLIC_APP_URL = "https://gov.example.org/"
    expect(isPublicUrlMisconfigured()).toBe(false)
    expect(publicAssetBase()).toBe("https://gov.example.org/r")
    // Only the host counts: "localhost" elsewhere in the URL is fine.
    cfg.env.NEXT_PUBLIC_APP_URL = "https://localhost-tools.example.org"
    expect(isPublicUrlMisconfigured()).toBe(false)
  })
})

describe("putObject", () => {
  it("writes nothing when the public URL isn't configured", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    await expect(
      putObject({ key: "user-avatars/u.png", body: Buffer.from("x"), contentType: "image/png" }),
    ).rejects.toThrow(PublicUrlNotConfiguredError)
    expect(cfg.sent).toEqual([])
  })

  it("returns the public URL of what it stored otherwise", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    cfg.env.NEXT_PUBLIC_APP_URL = "https://gov.example.org"
    const put = await putObject({
      key: "user-avatars/u.png",
      body: Buffer.from("x"),
      contentType: "image/png",
    })
    expect(put.url).toBe("https://gov.example.org/r/user-avatars/u.png")
    expect(cfg.sent).toHaveLength(1)
  })
})

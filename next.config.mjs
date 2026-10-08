// env validation runs at app runtime via lib/env.ts (first import triggers zod parse).
// We don't import it here because next.config.mjs is plain ESM and cannot load TS modules.

import { readFileSync } from "node:fs"

// The release shown in the footer comes from package.json.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // wss: covers all WebSocket targets (Enjin RPC, Dwellir fallback,
      // WalletConnect relay). https: covers WC metadata + Subscan + OG.
      "connect-src 'self' wss: https:",
      "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },

  reactStrictMode: true,

  // Polkadot SDK packages must be imported at runtime, not bundled, on the server.
  serverExternalPackages: [
    "@polkadot/api",
    "@polkadot/util",
    "@polkadot/util-crypto",
    "@polkadot/keyring",
    "@polkadot/extension-dapp",
    "@neondatabase/serverless",
  ],

  images: {
    unoptimized: true,
  },

  // The referendum share image reads its Inter fonts from disk at run time.
  outputFileTracingIncludes: {
    "/og/referendum/[network]/[index]": ["./lib/og/fonts/*.woff"],
  },

  // Empty turbopack config silences the "no turbopack config" warning under
  // Next 16's default Turbopack build.
  turbopack: {},

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig

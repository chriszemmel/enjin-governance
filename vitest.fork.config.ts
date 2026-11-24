import { defineConfig } from "vitest/config"
import path from "node:path"

/**
 * `pnpm test:fork`: signing checks against a Chopsticks fork of Enjin Relay.
 * They need the network (they fork mainnet state) and take minutes, so they
 * are not part of `pnpm test` or CI.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["fork/**/*.fork.ts"],
    globalSetup: ["fork/global-setup.ts"],
    // One fork, one chain: blocks are produced in order.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "server-only": path.resolve(__dirname, "./test/server-only-stub.ts"),
    },
  },
})

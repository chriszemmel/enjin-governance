import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    environment: "node",
    // Component tests opt into jsdom per file (`@vitest-environment jsdom`).
    include: [
      "lib/**/*.{test,spec}.ts",
      "lib/**/__tests__/**/*.ts",
      "components/**/*.test.tsx",
    ],
    exclude: ["node_modules", ".next", "dist"],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
      exclude: ["**/__tests__/**", "**/*.{test,spec}.{ts,tsx}", "lib/__sec__/**", "components/ui/**"],
      reporter: ["text-summary", "json-summary", "html"],
      // Floors for the code that decides what a vote, a delegation or a
      // sign-in means. They only ever go up: when a QA round lifts the
      // numbers, raise these to match - never lower them to get green.
      thresholds: {
        "lib/governance/**": { lines: 93, branches: 83, functions: 96, statements: 92 },
        "lib/auth/**": { lines: 94, branches: 87, functions: 100, statements: 92 },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      // `server-only` throws on import outside RSC. Stub it so modules
      // that guard themselves with it remain importable from Vitest.
      "server-only": path.resolve(__dirname, "./test/server-only-stub.ts"),
    },
  },
})

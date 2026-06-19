import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.{test,spec}.ts", "lib/**/__tests__/**/*.ts"],
    exclude: ["node_modules", ".next", "dist"],
    globals: false,
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

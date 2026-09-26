import { defineConfig, devices } from "@playwright/test"

/**
 * Browser tests (e2e/) against the production build.
 *
 *   pnpm test:e2e                     builds, starts on :3100, runs
 *   E2E_SKIP_BUILD=1 pnpm test:e2e    reuses the last build (CI builds in its own step)
 *
 * The build must have been made with NEXT_PUBLIC_APP_URL=http://localhost:3100.
 * E2E_PORT picks another port (and that origin for the build), e.g. when a
 * server already runs on 3100: a running server there would be reused.
 * PW_CHROMIUM_PATH points at a Chromium binary when Playwright's own
 * download isn't available. E2E_WS_RELAY=0: see e2e/support/chain-relay.ts.
 */
const PORT = Number(process.env.E2E_PORT) || 3100
const baseURL = `http://localhost:${PORT}`
const CI = !!process.env.CI
const executablePath = process.env.PW_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: CI,
  // Chain data comes from the public Canary RPC; a retry covers a slow node.
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,
  // The first page load waits for the chain connection.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: CI
    ? [["github"], ["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `pnpm start -p ${PORT}`
      : `pnpm build && pnpm start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !CI,
    timeout: 300_000,
    env: { NEXT_PUBLIC_APP_URL: baseURL },
    stdout: "ignore",
    stderr: "pipe",
  },
})

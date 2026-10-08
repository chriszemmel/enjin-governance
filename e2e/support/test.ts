/**
 * The `test` every spec imports. Each test gets:
 *   - a fake Polkadot extension wallet holding a throwaway address, whose
 *     signer refuses everything (nothing is ever signed),
 *   - every /api/* and /r/* request answered with test data (mock-api.ts),
 *   - no requests to outside hosts, except the Canary Relay RPC.
 */
import { test as base, expect, type Page } from "@playwright/test"
import { relayChainSockets, relayEnabled } from "./chain-relay"
import { ME, PROPOSAL_PATH } from "./data"
import { installApiMocks, type ApiMocks, type ModerationRole } from "./mock-api"

type Options = {
  /** Whether /api/auth/me answers with a signed-in user. */
  signedIn: boolean
  /** What /api/moderation/me answers. */
  moderationRole: ModerationRole
}

export const test = base.extend<Options & { api: ApiMocks }>({
  signedIn: [true, { option: true }],
  moderationRole: [null, { option: true }],

  context: async ({ context, baseURL }, provide) => {
    const origin = new URL(baseURL ?? "http://localhost:3100").origin
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin })
    await context.addInitScript(installFakeWallet, ME)
    // The app itself only. Outside hosts would make the tests depend on
    // services they don't control (and must never touch production ones).
    await context.route(
      (url) => /^https?:$/.test(url.protocol) && url.origin !== origin,
      (route) => route.abort("blockedbyclient"),
    )
    const closeRelay = relayEnabled ? await relayChainSockets(context) : () => {}
    await provide(context)
    closeRelay()
  },

  api: [
    async ({ page, signedIn, moderationRole }, provide) => {
      await provide(await installApiMocks(page, { signedIn, role: moderationRole }))
    },
    { auto: true },
  ],
})

export { expect }

/** Runs in the page before any app code: the wallet the app finds. */
function installFakeWallet(address: string) {
  localStorage.setItem(
    "enjin-governance:wallet",
    JSON.stringify({ state: { connectorId: "polkadot-js", activeAddress: address }, version: 0 }),
  )
  const account = { address, name: "e2e throwaway wallet", type: "sr25519" }
  const refuse = async () => {
    throw new Error("The e2e wallet never signs")
  }
  const injected = {
    accounts: {
      get: async () => [account],
      subscribe: (cb: (accounts: (typeof account)[]) => void) => {
        cb([account])
        return () => {}
      },
    },
    signer: { signRaw: refuse, signPayload: refuse },
    metadata: { get: async () => [], provide: async () => true },
  }
  ;(window as unknown as { injectedWeb3: unknown }).injectedWeb3 = {
    "polkadot-js": { version: "0.46.1", enable: async () => injected },
  }
}

/**
 * Opens Canary referendum 13 with its test metadata. The chain part is
 * real, so the first load waits for the RPC connection. It also waits for
 * the treasury summary: it comes with the call, decoded after the archive
 * history, and pushes everything below it (the EGOV1 header and its menu)
 * down, so a test that clicks there first could hit a moving target.
 */
export async function openProposal(page: Page) {
  await page.goto(PROPOSAL_PATH)
  await expect(page.getByText("EGOV1 · Verified")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("Treasury request", { exact: true })).toBeVisible({
    timeout: 60_000,
  })
}

/** /create with the fake wallet connected and the form ready. */
export async function openComposer(page: Page) {
  await page.goto("/create")
  await expect(page.getByPlaceholder(ME)).toBeEnabled({ timeout: 30_000 })
}

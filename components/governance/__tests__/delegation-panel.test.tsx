// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { encodeAddress } from "@polkadot/util-crypto"
import { initializeWasm } from "@/lib/chain/ss58"
import { createFakeChain } from "@/test/fake-chain"
import { defined } from "@/test/defined"
import { DelegationPanel } from "../delegation-panel"

/**
 * What the delegation panel shows - target, tracks, conviction, amount -
 * and what it hands the signer, through the real `useExtrinsic`.
 */

const ENJ = 10n ** 18n
const ENJIN_PREFIX = 2135
const CANARY_PREFIX = 9030
const ALICE = encodeAddress(new Uint8Array(32).fill(1), ENJIN_PREFIX)
const BOB = encodeAddress(new Uint8Array(32).fill(2), ENJIN_PREFIX)

const state = vi.hoisted(() => ({
  chain: null as unknown as ReturnType<typeof createFakeChain>,
  balance: 0n as bigint | null,
  delegations: [] as unknown[],
  locks: [] as unknown[],
  tracks: [] as Array<{ id: number; name: string }>,
  activeAddress: "",
}))

vi.mock("@/lib/chain/use-chain", async () => {
  const { CHAINS } = await import("@/lib/chain/chains")
  return {
    useActiveChain: () => CHAINS["enjin-relay"],
    getActiveChain: () => CHAINS["enjin-relay"],
  }
})
vi.mock("@/lib/query/hooks/use-api", () => ({ useApi: () => ({ data: state.chain.api }) }))
vi.mock("@/lib/wallet/use-wallet", () => ({
  useWallet: () => ({
    status: "connected",
    connectorId: "polkadot-js",
    session: { connectorId: "polkadot-js" },
    activeAddress: state.activeAddress,
  }),
}))
vi.mock("@/lib/wallet/connector-registry", () => ({
  getConnectorMeta: () => ({ connector: { getSigner: async () => ({ signPayload: vi.fn() }) } }),
  walletDisplayFor: () => ({ name: "Test Wallet", icon: "/wallet.svg" }),
}))
vi.mock("@/lib/wallet/use-sign-flow", () => ({
  useSignFlow: () => ({
    isWalletConnect: false,
    isOpen: false,
    open: () => {},
    close: () => {},
    deepLinkUrl: "",
  }),
}))
vi.mock("@/lib/query/hooks/use-balance", () => ({ useBalance: () => ({ data: state.balance }) }))
vi.mock("@/lib/query/hooks/use-delegations", () => ({
  useDelegations: () => ({ data: state.delegations, isPending: false }),
}))
vi.mock("@/lib/query/hooks/use-tracks", () => ({ useTracks: () => ({ data: state.tracks }) }))
vi.mock("@/lib/query/hooks/use-account-locks", () => ({
  useAccountLocks: () => ({ data: state.locks }),
}))
vi.mock("@/lib/query/hooks/use-pool-nft", () => ({ usePoolNft: () => ({ data: undefined }) }))

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DelegationPanel address={ALICE} />
    </QueryClientProvider>,
  )
}

type User = ReturnType<typeof userEvent.setup>
const form = () => {
  const heading = screen.getByText("Delegate ENJ voting power")
  return within(defined(heading.parentElement, "delegate form"))
}
const select = (label: string) => form().getByLabelText(label) as HTMLSelectElement
const input = (label: RegExp) => form().getByLabelText(label) as HTMLInputElement

async function fill(
  user: User,
  opts: { track?: string; conviction?: string; to?: string; amount?: string },
) {
  if (opts.track) await user.selectOptions(select("Track"), opts.track)
  if (opts.conviction) await user.selectOptions(select("Conviction"), opts.conviction)
  if (opts.to !== undefined) await user.type(input(/Delegate to/), opts.to)
  if (opts.amount !== undefined) await user.type(input(/^Amount/), opts.amount)
}

async function signedExtrinsic() {
  await waitFor(() => expect(state.chain.signed).toHaveLength(1))
  return defined(state.chain.signed[0]).extrinsic
}

beforeAll(async () => {
  await initializeWasm()
})
beforeEach(() => {
  state.chain = createFakeChain()
  state.balance = 500n * ENJ
  state.delegations = []
  state.locks = []
  state.tracks = [
    { id: 0, name: "root" },
    { id: 2, name: "referendum_canceller" },
    { id: 200, name: "small_tipper" },
    { id: 201, name: "big_tipper" },
  ]
  state.activeAddress = ALICE
})
afterEach(() => {
  cleanup()
})

describe("DelegateForm - one track", () => {
  it("signs delegate(track, target, conviction, amount, ENJ) as entered", async () => {
    const user = userEvent.setup()
    renderPanel()
    await fill(user, { track: "200", conviction: "Locked4x", to: BOB, amount: "100.25" })

    const button = form().getByRole("button", { name: "Delegate" }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    await user.click(button)

    const extrinsic = await signedExtrinsic()
    expect(extrinsic.call).toBe("convictionVoting.delegate")
    expect(extrinsic.args).toEqual([
      200,
      BOB,
      "Locked4x",
      ((10025n * ENJ) / 100n).toString(),
      { Enj: null },
    ])
  })

  it("shows the conviction as its multiplier, 0.1x labelled as no lock", () => {
    renderPanel()
    const labels = Array.from(select("Conviction").options, (o) => o.textContent?.trim())
    expect(labels).toEqual(["0.1x (no lock)", "1x", "2x", "3x", "4x", "5x", "6x"])
    expect(select("Conviction").value).toBe("Locked1x")
  })
})

describe("DelegateForm - all tracks", () => {
  it("batches one delegate per eligible track, skipping delegated and voted ones", async () => {
    const user = userEvent.setup()
    state.delegations = [
      {
        trackId: 0,
        target: BOB,
        balance: 1n * ENJ,
        conviction: "Locked1x",
        currencyRaw: { Enj: null },
      },
    ]
    state.locks = [
      {
        trackId: 2,
        locked: 1n,
        prior: null,
        activeVotes: [{ pollIndex: 1 }],
        currencyRaw: { Enj: null },
      },
    ]
    renderPanel()

    expect(select("Track").options[0]?.textContent).toBe("All tracks (2)")
    await fill(user, { conviction: "Locked2x", to: BOB, amount: "10" })
    expect(
      form().getByText(/Delegates across all 2\s+eligible tracks in one signature/),
    ).toBeTruthy()

    await user.click(form().getByRole("button", { name: "Delegate all tracks" }))
    const extrinsic = await signedExtrinsic()
    expect(extrinsic.call).toBe("utility.batchAll")
    const inner = defined(extrinsic.args[0], "batched calls") as Array<{
      call: string
      args: unknown[]
    }>
    expect(inner.map((c) => [c.call, c.args])).toEqual([
      ["convictionVoting.delegate", [200, BOB, "Locked2x", (10n * ENJ).toString(), { Enj: null }]],
      ["convictionVoting.delegate", [201, BOB, "Locked2x", (10n * ENJ).toString(), { Enj: null }]],
    ])
  })

  it("refuses a single track that is already delegated", async () => {
    const user = userEvent.setup()
    state.delegations = [
      {
        trackId: 200,
        target: BOB,
        balance: 1n * ENJ,
        conviction: "Locked1x",
        currencyRaw: { Enj: null },
      },
    ]
    renderPanel()
    await fill(user, { track: "200", to: BOB, amount: "1" })
    expect(
      form().getByText("Already delegating or voting on this track - resolve that first."),
    ).toBeTruthy()
    expect((form().getByRole("button", { name: "Delegate" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe("DelegateForm - nothing to sign", () => {
  it("refuses delegating to yourself, also under another chain's prefix", async () => {
    const user = userEvent.setup()
    renderPanel()
    await fill(user, { track: "200", to: ALICE, amount: "1" })
    expect(form().getByText("You can't delegate to your own account.")).toBeTruthy()
    expect((form().getByRole("button", { name: "Delegate" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it("refuses an address of another chain", async () => {
    const user = userEvent.setup()
    renderPanel()
    await fill(user, {
      track: "200",
      to: encodeAddress(new Uint8Array(32).fill(2), CANARY_PREFIX),
      amount: "1",
    })
    expect(form().getByText("Enter a valid address for this chain.")).toBeTruthy()
  })

  it("refuses more than the free balance", async () => {
    const user = userEvent.setup()
    state.balance = 3n * ENJ
    renderPanel()
    await fill(user, { track: "200", to: BOB, amount: "3.1" })
    expect(form().getByText("Amount exceeds your free balance.")).toBeTruthy()
    await user.click(form().getByRole("button", { name: "Delegate" }))
    expect(state.chain.signed).toHaveLength(0)
  })
})

describe("DelegationPanel - undelegate", () => {
  it("lists a delegation and undelegates it on its track, in its currency", async () => {
    const user = userEvent.setup()
    state.delegations = [
      {
        trackId: 200,
        target: BOB,
        balance: 100n * ENJ,
        conviction: "Locked3x",
        currencyRaw: { SEnj: { tokenId: 4 } },
      },
    ]
    renderPanel()

    const row = screen.getByRole("listitem")
    expect(row.textContent).toContain("Small Tipper")
    expect(row.textContent).toContain("3x")
    expect(row.textContent).toContain("sENJ · Pool #4")
    // The amount of an sENJ delegation is printed with the chain ticker (ENJ).
    expect(row.textContent).toContain("100 ENJ")

    await user.click(within(row).getByRole("button", { name: /Undelegate/ }))
    const extrinsic = await signedExtrinsic()
    expect(extrinsic.call).toBe("convictionVoting.undelegate")
    expect(extrinsic.args).toEqual([200, { SEnj: { tokenId: 4 } }])
  })
})

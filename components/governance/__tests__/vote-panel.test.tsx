// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { CHAINS } from "@/lib/chain/chains"
import type { MyVoteOnPoll } from "@/lib/governance/conviction-voting"
import { createFakeChain } from "@/test/fake-chain"
import { defined } from "@/test/defined"
import { VotingPanel } from "../vote-panel"

/**
 * What the vote panel shows - amount, conviction, voting power - and what
 * it hands the signer. `useExtrinsic` is the real hook; only the chain,
 * the wallet and the data hooks are faked, so `signed` holds the exact
 * extrinsic passed to `signAsync`.
 */

const ENJ = 10n ** 18n
const ALICE = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const REFERENDUM = 42
const TRACK = 2

const state = vi.hoisted(() => ({
  chain: null as unknown as ReturnType<typeof createFakeChain>,
  balance: 0n as bigint | null,
  staked: [] as unknown[],
  myVotes: [] as unknown[],
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
    activeAddress: "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX",
  }),
  useDisplayAddress: () => ({ full: "enCrdz…", short: "enCr…FidX" }),
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
vi.mock("@/lib/query/hooks/use-balance", () => ({
  useBalance: () => ({ data: state.balance, isPending: false }),
}))
vi.mock("@/lib/query/hooks/use-staked-enj-balances", () => ({
  useStakedEnjBalances: () => ({ data: state.staked }),
}))
vi.mock("@/lib/query/hooks/use-my-votes", () => ({
  useMyVotesOnPoll: () => ({ data: state.myVotes, isSuccess: true }),
}))
vi.mock("@/lib/query/hooks/use-pool-nft", () => ({ usePoolNft: () => ({ data: undefined }) }))
vi.mock("@/components/wallet/wallet-modal", () => ({ WalletModal: () => null }))

function renderPanel(props: Partial<Parameters<typeof VotingPanel>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <VotingPanel referendumIndex={REFERENDUM} isOngoing trackId={TRACK} {...props} />
    </QueryClientProvider>,
  )
}

const amountInput = () => screen.getByLabelText(/^Amount/) as HTMLInputElement
const submitButton = (name: RegExp) => screen.getByRole("button", { name })

async function setAmount(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(amountInput())
  if (value) await user.type(amountInput(), value)
}

async function pickConviction(user: ReturnType<typeof userEvent.setup>, multiplier: string) {
  await user.click(screen.getByRole("button", { name: /^Conviction:/ }))
  const options = screen
    .getAllByRole("button")
    .filter((b) => b.textContent?.endsWith(`${multiplier}x`))
  await user.click(defined(options.at(-1), `${multiplier}x option`))
}

/** The one extrinsic the signer received. */
async function signedExtrinsic() {
  await waitFor(() => expect(state.chain.signed).toHaveLength(1))
  const [record] = state.chain.signed
  return defined(record)
}

beforeEach(() => {
  state.chain = createFakeChain()
  state.balance = 1_000n * ENJ
  state.staked = []
  state.myVotes = []
})
afterEach(() => {
  cleanup()
})

describe("VotingPanel - Standard votes", () => {
  it("shows amount × conviction and signs exactly that vote", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole("button", { name: "Aye" }))
    await setAmount(user, "12.5")
    await pickConviction(user, "3")

    expect(screen.getByText(/≈\s*37\.5\s*ENJ/)).toBeTruthy()
    expect(screen.getByText(/12\.5 ENJ × 3/)).toBeTruthy()
    // Locked3x = 4 lock periods of 100,800 blocks (6 s) = 28 days.
    expect(screen.getByText("Lock for 28d after the referendum ends")).toBeTruthy()

    await user.click(submitButton(/^Vote Aye$/))
    const { extrinsic, address, options } = await signedExtrinsic()
    expect(extrinsic.call).toBe("convictionVoting.vote")
    expect(extrinsic.args).toEqual([
      REFERENDUM,
      {
        Standard: {
          vote: { aye: true, conviction: "Locked3x" },
          balance: ((125n * ENJ) / 10n).toString(),
        },
      },
      { Enj: null },
    ])
    expect(address).toBe(ALICE)
    expect(options).toMatchObject({ era: expect.any(Number) })
  })

  it("signs a Nay at the default 1x conviction", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole("button", { name: "Nay" }))
    await setAmount(user, "7")
    expect(screen.getByRole("button", { name: /^Conviction:/ }).textContent).toContain("1x")

    await user.click(submitButton(/^Vote Nay$/))
    const { extrinsic } = await signedExtrinsic()
    expect(extrinsic.args[1]).toEqual({
      Standard: { vote: { aye: false, conviction: "Locked1x" }, balance: (7n * ENJ).toString() },
    })
  })

  it("keeps the smallest unit exact", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole("button", { name: "Aye" }))
    await setAmount(user, "0.000000000000000001")
    await pickConviction(user, "0.1")
    await user.click(submitButton(/^Vote Aye$/))

    const { extrinsic } = await signedExtrinsic()
    expect(extrinsic.args[1]).toEqual({
      Standard: { vote: { aye: true, conviction: "None" }, balance: "1" },
    })
  })

  it("signs nothing for an amount above the balance, zero, or unreadable", async () => {
    const user = userEvent.setup()
    state.balance = 5n * ENJ
    renderPanel()
    await user.click(screen.getByRole("button", { name: "Aye" }))

    await setAmount(user, "5.000000000000000001")
    const tooMuch = submitButton(/^Not enough balance$/) as HTMLButtonElement
    expect(tooMuch.disabled).toBe(true)

    await setAmount(user, "0")
    expect((submitButton(/^Vote Aye$/) as HTMLButtonElement).disabled).toBe(true)

    await setAmount(user, "abc")
    expect((submitButton(/^Vote Aye$/) as HTMLButtonElement).disabled).toBe(true)

    expect(state.chain.signed).toHaveLength(0)
  })

  it("reads a comma as the decimal separator, in the preview and in the signed amount", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole("button", { name: "Aye" }))

    // "1,000" is one ENJ, not a thousand: the preview says so before signing.
    await setAmount(user, "1,000")
    expect(screen.getByText(/≈\s*1\s*ENJ/)).toBeTruthy()

    await setAmount(user, "1,5")
    expect(screen.getByText(/≈\s*1\.5\s*ENJ/)).toBeTruthy()
    await user.click(submitButton(/^Vote Aye$/))
    const { extrinsic } = await signedExtrinsic()
    expect(extrinsic.args[1]).toEqual({
      Standard: {
        vote: { aye: true, conviction: "Locked1x" },
        balance: ((15n * ENJ) / 10n).toString(),
      },
    })
  })
})

describe("VotingPanel - Abstain", () => {
  it("drops conviction and signs a SplitAbstain of the full amount", async () => {
    const user = userEvent.setup()
    renderPanel()

    await pickConviction(user, "6")
    await user.click(screen.getByRole("button", { name: "Abstain" }))
    await setAmount(user, "20")

    const convictionButton = screen.getByRole("button", {
      name: /^Conviction:/,
    }) as HTMLButtonElement
    expect(convictionButton.disabled).toBe(true)
    expect(convictionButton.textContent).toContain("None for Abstain")
    expect(convictionButton.textContent).toContain("1x")
    expect(screen.getByText("No lock - counts toward support only")).toBeTruthy()

    await user.click(submitButton(/^Vote Abstain$/))
    const { extrinsic } = await signedExtrinsic()
    expect(extrinsic.call).toBe("convictionVoting.vote")
    expect(extrinsic.args).toEqual([
      REFERENDUM,
      { SplitAbstain: { aye: "0", nay: "0", abstain: (20n * ENJ).toString() } },
      { Enj: null },
    ])
  })
})

describe("VotingPanel - voting with sENJ", () => {
  it("signs with the chosen pool's currency and checks the sENJ balance", async () => {
    const user = userEvent.setup()
    state.staked = [
      {
        poolId: 7,
        poolName: "Pool Seven",
        poolState: "Open",
        senjBalance: 50n * ENJ,
        realEnjBalance: 55n * ENJ,
      },
    ]
    renderPanel()

    await user.click(screen.getByRole("button", { name: /ENJ/ }))
    await user.click(await screen.findByRole("button", { name: /Pool Seven/ }))
    expect(screen.getByText("Amount (sENJ)")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Aye" }))
    await setAmount(user, "60")
    expect((submitButton(/^Not enough balance$/) as HTMLButtonElement).disabled).toBe(true)

    await setAmount(user, "50")
    expect(screen.getByText(/50 sENJ × 1/)).toBeTruthy()
    await user.click(submitButton(/^Vote Aye$/))

    const { extrinsic } = await signedExtrinsic()
    expect(extrinsic.args).toEqual([
      REFERENDUM,
      {
        Standard: { vote: { aye: true, conviction: "Locked1x" }, balance: (50n * ENJ).toString() },
      },
      { SEnj: { tokenId: 7 } },
    ])
  })
})

describe("VotingPanel - an existing vote", () => {
  const existing: MyVoteOnPoll = {
    vote: {
      type: "Standard",
      pollIndex: REFERENDUM,
      trackId: TRACK,
      aye: false,
      balance: (25n * ENJ) / 10n,
      conviction: "Locked2x",
    },
    currencyRaw: { Enj: null },
  }

  it("loads the vote into the form and signs the change as shown", async () => {
    const user = userEvent.setup()
    state.myVotes = [existing]
    renderPanel()

    await waitFor(() => expect(amountInput().value).toBe("2.5"))
    expect(screen.getByRole("button", { name: /^Conviction:/ }).textContent).toContain("2x")

    await user.click(screen.getByRole("button", { name: "Aye" }))
    await user.click(submitButton(/^Change to Aye$/))
    const { extrinsic } = await signedExtrinsic()
    expect(extrinsic.args[1]).toEqual({
      Standard: {
        vote: { aye: true, conviction: "Locked2x" },
        balance: ((25n * ENJ) / 10n).toString(),
      },
    })
  })

  it("removes the vote on its own track and in its own currency", async () => {
    const user = userEvent.setup()
    state.myVotes = [{ ...existing, currencyRaw: { SEnj: { tokenId: 3 } } }]
    // A decided referendum: no track from the referendum, the vote's own is used.
    renderPanel({ isOngoing: false, trackId: null })

    const stack = screen.getByText(/Your vote/).closest("div")?.parentElement
    const remove = within(defined(stack ?? null, "panel")).getByRole("button", { name: /Remove/i })
    await user.click(remove)

    const { extrinsic } = await signedExtrinsic()
    expect(extrinsic.call).toBe("convictionVoting.removeVote")
    expect(extrinsic.args).toEqual([TRACK, REFERENDUM, { SEnj: { tokenId: 3 } }])
  })
})

describe("VotingPanel - nothing to sign", () => {
  it("offers no vote on a closed referendum", () => {
    renderPanel({ isOngoing: false })
    expect(screen.getByText("Voting has ended for this referendum.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Vote / })).toBeNull()
  })

  it("asks for a choice before it can submit", () => {
    renderPanel()
    expect((submitButton(/^Select a vote$/) as HTMLButtonElement).disabled).toBe(true)
  })
})

// Keep the chain config import honest: the panel formats with mainnet's 18 decimals.
it("uses mainnet's decimals and ticker", () => {
  expect(CHAINS["enjin-relay"]).toMatchObject({ decimals: 18, ticker: "ENJ" })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createFakeChain } from "@/test/fake-chain"
import { defined } from "@/test/defined"
import { FellowshipVotePanel } from "../fellowship-vote-panel"

/**
 * The fellowship vote signs `fellowshipCollective.vote(poll, aye)`. Pins
 * what it signs, and the Retry finding in docs/security/tx-signing-review.md.
 */

const state = vi.hoisted(() => ({
  chain: null as unknown as ReturnType<typeof createFakeChain>,
  myVote: null as { aye: boolean; weight: number } | null,
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
    connectorId: "enjin-wallet",
    session: { connectorId: "enjin-wallet" },
    activeAddress: "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX",
  }),
}))
vi.mock("@/lib/wallet/connector-registry", () => ({
  getConnectorMeta: () => ({ connector: { getSigner: async () => ({ signPayload: vi.fn() }) } }),
  walletDisplayFor: () => ({ name: "Enjin Wallet", icon: "/wallet.svg" }),
}))
// WalletConnect: the sign-request modal (with its Retry) is what the user sees.
vi.mock("@/lib/wallet/use-sign-flow", () => ({
  useSignFlow: () => ({
    isWalletConnect: true,
    isOpen: true,
    open: () => {},
    close: () => {},
    deepLinkUrl: "",
  }),
}))
vi.mock("@/lib/query/hooks/use-fellowship", () => ({
  useMyRank: () => ({ rank: 5, isPending: false }),
  useMyFellowshipVote: () => ({ data: state.myVote }),
}))
vi.mock("@/components/wallet/wallet-modal", () => ({ WalletModal: () => null }))

const POLL = 4

function panel() {
  return <FellowshipVotePanel index={POLL} trackId={3} isOngoing />
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}>{panel()}</QueryClientProvider>)
  return {
    rerender: () =>
      view.rerender(<QueryClientProvider client={client}>{panel()}</QueryClientProvider>),
  }
}

beforeEach(() => {
  state.chain = createFakeChain()
  state.myVote = null
})
afterEach(() => {
  cleanup()
})

describe("FellowshipVotePanel", () => {
  it("signs vote(poll, aye) for the choice shown", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole("button", { name: "Aye" }))
    await user.click(screen.getByRole("button", { name: "Vote Aye" }))
    await waitFor(() => expect(state.chain.signed).toHaveLength(1))
    const { extrinsic } = defined(state.chain.signed[0])
    expect([extrinsic.call, extrinsic.args]).toEqual(["fellowshipCollective.vote", [POLL, true]])
  })

  // Finding F2: Retry rebuilds from the panel's current choice, and the
  // choice is cleared whenever the on-chain vote changes - e.g. when the
  // first attempt did land but the app reported it lost (90 s timeout),
  // and the vote shows up on the next refetch. Retry then signs Nay.
  it.fails(
    "Retry signs the choice the user made, even after the on-chain vote changed",
    async () => {
      const user = userEvent.setup()
      const view = renderPanel()
      state.chain.controls.rejectNextSigns = 1

      await user.click(screen.getByRole("button", { name: "Aye" }))
      await user.click(screen.getByRole("button", { name: "Vote Aye" }))
      await screen.findByRole("button", { name: "Retry" })

      state.myVote = { aye: true, weight: 6 }
      view.rerender()
      await user.click(screen.getByRole("button", { name: "Retry" }))

      await waitFor(() => expect(state.chain.signed).toHaveLength(1))
      expect(defined(state.chain.signed[0]).extrinsic.args).toEqual([POLL, true])
    },
  )
})

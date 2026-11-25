// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import { u8aToHex } from "@polkadot/util"
import { CHAINS } from "@/lib/chain/chains"
import { initializeWasm } from "@/lib/chain/ss58"
import { createFakeChain } from "@/test/fake-chain"
import { defined } from "@/test/defined"
import { ClaimPayoutButton, formatFee } from "../claim-payout-button"

/**
 * Claiming a `treasury.spend`: a wallet that isn't connected is asked for
 * first, the confirmation says where the money goes, and what reaches the
 * signer is `treasury.payout(index)`, through the real `useExtrinsic`.
 */

const ENJ = 10n ** 18n
const chain = CHAINS["enjin-relay"]
const ALICE = encodeAddress(new Uint8Array(32).fill(1), 2135)
const BENEFICIARY = encodeAddress(new Uint8Array(32).fill(7), 2135)
const BENEFICIARY_HEX = u8aToHex(decodeAddress(BENEFICIARY))

const state = vi.hoisted(() => ({
  chain: null as unknown as ReturnType<typeof createFakeChain>,
  activeAddress: "",
  status: "connected" as "connected" | "disconnected",
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
    status: state.status,
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
vi.mock("@/components/wallet/wallet-modal", () => ({
  WalletModal: ({ open }: { open: boolean }) => (open ? <div>Connect a wallet</div> : null),
}))
vi.mock("@/components/profile/identicon", () => ({ PolkadotIdenticon: () => <span /> }))

function renderButton(over: Partial<Parameters<typeof ClaimPayoutButton>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ClaimPayoutButton
        spendIndex={4}
        amount={200_000n * ENJ}
        beneficiary={BENEFICIARY_HEX}
        expires="≈ Dec 29"
        chain={chain}
        {...over}
      />
    </QueryClientProvider>,
  )
}

beforeAll(async () => {
  await initializeWasm()
})
beforeEach(() => {
  state.chain = createFakeChain()
  state.activeAddress = ALICE
  state.status = "connected"
})
afterEach(() => {
  cleanup()
})

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Claim payout" }))
  return within(await screen.findByRole("dialog"))
}

describe("ClaimPayoutButton", () => {
  it("asks for a wallet first when none is connected, and signs nothing", async () => {
    const user = userEvent.setup()
    state.status = "disconnected"
    renderButton()
    await user.click(screen.getByRole("button", { name: "Claim payout" }))
    expect(screen.getByText("Connect a wallet")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(state.chain.signed).toHaveLength(0)
  })

  it("confirms the amount, where it goes, the call and the deadline", async () => {
    const user = userEvent.setup()
    renderButton()
    const dialog = await open(user)
    expect(dialog.getByText("Confirm payout")).toBeTruthy()
    expect(dialog.getByText("200,000 ENJ")).toBeTruthy()
    expect(dialog.getByText("treasury.payout(4)")).toBeTruthy()
    expect(dialog.getByText("The funds go to the beneficiary, not to you.")).toBeTruthy()
    expect(dialog.getByText("Expires ≈ Dec 29")).toBeTruthy()
    // The address is a link to Subscan, and can be copied in full.
    const link = dialog.getByRole("link")
    expect(link.getAttribute("href")).toContain(BENEFICIARY)
    expect(dialog.getByRole("button", { name: "Copy address" })).toBeTruthy()
    expect(state.chain.signed).toHaveLength(0)
  })

  it("says so when the connected account is the beneficiary", async () => {
    const user = userEvent.setup()
    state.activeAddress = BENEFICIARY
    renderButton()
    const dialog = await open(user)
    expect(dialog.getByText("The funds go to you.")).toBeTruthy()
    expect(dialog.getByText("You ·")).toBeTruthy()
    expect(dialog.queryByText(/not to you/)).toBeNull()
  })

  it("shows what the claim costs the caller, from the node", async () => {
    const user = userEvent.setup()
    state.chain.controls.partialFee = 12_500_000_000_000_000n
    renderButton()
    const dialog = await open(user)
    expect(await dialog.findByText("≈ 0.0125 ENJ")).toBeTruthy()
    expect(dialog.getByText("Fee, paid by you")).toBeTruthy()
  })

  it("shows the fee as the node estimated it, rounded up to four decimals", () => {
    // The fee charged for treasury.payout on a fork of mainnet: 0.005752...
    expect(formatFee(5_752_791_909_689_424n, chain)).toBe("≈ 0.0058 ENJ")
    expect(formatFee(12_500_000_000_000_000n, chain)).toBe("≈ 0.0125 ENJ")
    expect(formatFee(12_500_000_000_000_001n, chain)).toBe("≈ 0.0126 ENJ")
  })

  it("never shows a tiny fee as zero", () => {
    expect(formatFee(99_999_999_999_999n, chain)).toBe("< 0.0001 ENJ")
    expect(formatFee(100_000_000_000_000n, chain)).toBe("≈ 0.0001 ENJ")
    expect(formatFee(1n, chain)).toBe("< 0.0001 ENJ")
  })

  it("leaves out the deadline when it isn't known", async () => {
    const user = userEvent.setup()
    renderButton({ expires: null })
    const dialog = await open(user)
    expect(dialog.queryByText(/^Expires/)).toBeNull()
  })

  it("cancelling signs nothing", async () => {
    const user = userEvent.setup()
    renderButton()
    const dialog = await open(user)
    await user.click(dialog.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(state.chain.signed).toHaveLength(0)
  })

  it("signs treasury.payout(index) as the connected account, and nothing else", async () => {
    const user = userEvent.setup()
    renderButton()
    const dialog = await open(user)
    await user.click(dialog.getByRole("button", { name: "Claim payout" }))
    await waitFor(() => expect(state.chain.signed).toHaveLength(1))
    const signed = defined(state.chain.signed[0])
    expect(signed.extrinsic.call).toBe("treasury.payout")
    expect(signed.extrinsic.args).toEqual([4])
    expect(signed.address).toBe(ALICE)
  })
})

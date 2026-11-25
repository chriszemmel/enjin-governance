// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { initializeWasm } from "@/lib/chain/ss58"
import { CHAINS } from "@/lib/chain/chains"
import { VoteDetailModal } from "../vote-detail-modal"

/**
 * The details of an sENJ vote: the amount cast, the ENJ value the tally holds
 * for it and the rate that gave it.
 */

const ENJ = 10n ** 18n
const chain = CHAINS["enjin-relay"]

vi.mock("@/components/profile/user-chip", () => ({ UserChip: () => <span /> }))
vi.mock("@/lib/query/hooks/use-pool-nft", () => ({ usePoolNft: () => ({ data: undefined }) }))
vi.mock("../pool-nft-avatar", () => ({ PoolNftAvatar: () => <span /> }))

beforeAll(async () => {
  await initializeWasm()
})
afterEach(cleanup)

function open(over: Partial<Parameters<typeof VoteDetailModal>[0]>) {
  render(
    <VoteDetailModal
      open
      onOpenChange={() => {}}
      chain={chain}
      voter="enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
      aye
      conviction="Locked1x"
      multiplier={1}
      lockBlocks={100_800}
      balance={75_000n * ENJ}
      currency={{ kind: "SEnj", poolId: 59 }}
      extrinsicIndex={null}
      {...over}
    />,
  )
}

describe("VoteDetailModal", () => {
  it("shows the sENJ cast, its ENJ value and the rate", () => {
    // Mainnet referendum #20, pool 59: 75,000 sENJ counted as 103,820.66.
    open({ countedBalance: 103_820_665_888_782_910_000_000n })
    expect(screen.getByText("75,000 sENJ")).toBeTruthy()
    expect(screen.getByText(/≈\s*103,820\.66\s*ENJ/)).toBeTruthy()
    expect(screen.getByText("1 sENJ ≈ 1.3843 ENJ")).toBeTruthy()
  })

  it("a vote counted 1:1 shows a rate of 1", () => {
    open({ countedBalance: 75_000n * ENJ })
    expect(screen.getByText("1 sENJ ≈ 1.0000 ENJ")).toBeTruthy()
  })

  it("shows no ENJ value without a counted amount, or for an ENJ vote", () => {
    open({ countedBalance: null })
    expect(screen.queryByText(/1 sENJ ≈/)).toBeNull()
    cleanup()
    open({ currency: { kind: "Enj" }, balance: 5n * ENJ, countedBalance: 5n * ENJ })
    expect(screen.queryByText(/1 sENJ ≈/)).toBeNull()
  })

  it("still shows the lock", () => {
    open({ countedBalance: 75_000n * ENJ })
    expect(screen.getByText("Lock duration")).toBeTruthy()
  })
})

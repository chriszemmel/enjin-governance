// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { encodeAddress } from "@polkadot/util-crypto"
import { initializeWasm } from "@/lib/chain/ss58"
import { CHAINS } from "@/lib/chain/chains"
import type { ReferendumVote } from "@/lib/query/hooks/use-referendum-votes"
import { VotesList } from "../votes-list"

/**
 * An sENJ vote is listed at the ENJ value the tally holds for it, with an
 * sENJ badge, and every row is one line: amounts turn compact from 100,000
 * and the lock is left to the details.
 */

const ENJ = 10n ** 18n
const chain = CHAINS["enjin-relay"]
const voter = (n: number) => encodeAddress(new Uint8Array(32).fill(n), 2135)

const state = vi.hoisted(() => ({ rows: [] as ReferendumVote[] }))
vi.mock("@/lib/query/hooks/use-referendum-votes", () => ({
  useReferendumVotes: () => ({ isPending: false, data: state.rows }),
}))
vi.mock("@/lib/query/hooks/use-referendum-vote-extrinsics", () => ({
  useReferendumVoteExtrinsics: () => ({ data: undefined }),
}))
vi.mock("@/lib/query/hooks/use-prefetch-pool-nfts", () => ({ usePrefetchPoolNfts: () => {} }))
vi.mock("@/lib/query/hooks/use-api", () => ({ useApi: () => ({ data: undefined }) }))
vi.mock("../pool-nft-avatar", () => ({ PoolNftAvatar: () => <span /> }))

beforeAll(async () => {
  await initializeWasm()
})
afterEach(cleanup)

const enj = (n: number, amount: bigint, over: Partial<ReferendumVote> = {}): ReferendumVote => ({
  voter: voter(n),
  trackId: 2,
  voteRaw: 0x81,
  abstain: false,
  convictionRaw: 1,
  balance: amount,
  countedBalance: amount,
  currencyRaw: { Enj: null },
  blockNumber: null,
  timestamp: null,
  extrinsicIndex: null,
  ...over,
})
const senj = (n: number, cast: bigint, counted: bigint | null): ReferendumVote =>
  enj(n, cast, { countedBalance: counted, currencyRaw: { sEnj: { tokenId: 59 } } })

/** The text of each row's amount line, in order. */
function amounts(rows: ReferendumVote[]): string[] {
  state.rows = rows
  const { container } = render(<VotesList referendumIndex={20} chain={chain} />)
  return [...container.querySelectorAll("button")]
    .filter((b) => b.className.includes("rounded-lg"))
    .map((b) => b.querySelector(".font-mono.tabular-nums")?.parentElement?.textContent ?? "")
}

describe("VotesList rows", () => {
  it("lists an sENJ vote at its counted ENJ value with an sENJ badge", () => {
    expect(amounts([enj(1, 1n * ENJ), senj(2, 75_000n * ENJ, 61_820n * ENJ)])).toEqual([
      "1ENJ",
      "61,820ENJsENJ",
    ])
  })

  it("turns compact from 100,000 and stays in full below it", () => {
    expect(
      amounts([
        enj(1, 99_999n * ENJ),
        enj(2, 100_000n * ENJ),
        senj(3, 75_000n * ENJ, 103_820n * ENJ),
        senj(4, 10_000_000n * ENJ, 13_842_755n * ENJ),
      ]),
    ).toEqual(["99,999ENJ", "100.0KENJ", "103.8KENJsENJ", "13.84MENJsENJ"])
  })

  it("keeps the amount cast when the runtime has no counted amount", () => {
    expect(amounts([senj(1, 5n * ENJ, null)])).toEqual(["5sENJ"])
  })

  it("has no lock in a row", () => {
    state.rows = [enj(1, 1n * ENJ), enj(2, 1n * ENJ, { convictionRaw: 6, voteRaw: 0x86 })]
    const { container } = render(<VotesList referendumIndex={20} chain={chain} />)
    expect(container.textContent).not.toMatch(/lock/i)
  })
})

describe("VotesList note", () => {
  it("says sENJ is shown at its ENJ value, on two lines, when an sENJ vote is listed", () => {
    state.rows = [enj(1, 1n * ENJ), senj(2, 75_000n * ENJ, 103_820n * ENJ)]
    const { container } = render(<VotesList referendumIndex={20} chain={chain} />)
    const note = [...container.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("sENJ is shown at its ENJ value."),
    )
    expect(note?.innerHTML).toContain("<br>")
    expect(note?.textContent).toBe("sENJ is shown at its ENJ value.Tap a vote for details.")
    expect(note?.className).toContain("text-center")
  })

  it("has no note without an sENJ vote that has a counted amount", () => {
    state.rows = [enj(1, 1n * ENJ), senj(2, 5n * ENJ, null)]
    const { container } = render(<VotesList referendumIndex={20} chain={chain} />)
    expect(container.textContent).not.toContain("sENJ is shown at its ENJ value")
  })
})

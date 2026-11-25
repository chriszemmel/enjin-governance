// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { CHAINS } from "@/lib/chain/chains"
import type { ReferendumVote } from "@/lib/query/hooks/use-referendum-votes"
import { ParticipationGraph } from "../participation-graph"

/**
 * The participation chart weighs each vote by what the tally holds for it
 * (spec 1082's `counted`), so an sENJ vote counts at the pool's ENJ rate.
 */

const ENJ = 10n ** 18n
const chain = CHAINS["enjin-relay"]

const state = vi.hoisted(() => ({ rows: [] as ReferendumVote[] }))
vi.mock("@/lib/query/hooks/use-referendum-votes", () => ({
  useReferendumVotes: () => ({ isPending: false, isError: false, data: state.rows }),
}))

afterEach(cleanup)

const row = (over: Partial<ReferendumVote>): ReferendumVote => ({
  voter: "alice",
  trackId: 2,
  voteRaw: 0x81, // aye, 1x
  abstain: false,
  convictionRaw: 1,
  balance: 0n,
  countedBalance: null,
  currencyRaw: { Enj: null },
  blockNumber: null,
  timestamp: null,
  extrinsicIndex: null,
  ...over,
})

function renderGraph(rows: ReferendumVote[]): string {
  state.rows = rows
  const { container } = render(<ParticipationGraph referendumIndex={20} chain={chain} />)
  return container.textContent ?? ""
}

describe("ParticipationGraph", () => {
  it("weighs an sENJ vote by what the tally counts for it", () => {
    // Referendum #20: 75,000 sENJ cast, counted as 103,820.
    const text = renderGraph([
      row({
        balance: 75_000n * ENJ,
        countedBalance: 103_820n * ENJ,
        currencyRaw: { sEnj: { tokenId: 59 } },
      }),
    ])
    expect(text).toMatch(/1 aye · 103[.,]8/)
    expect(text).not.toMatch(/1 aye · 75/)
  })

  it("uses the amount cast when the runtime stores no counted amount", () => {
    const text = renderGraph([row({ balance: 75_000n * ENJ, countedBalance: null })])
    expect(text).toMatch(/1 aye · 75/)
  })
})

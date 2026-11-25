// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Stage } from "../stage"

/**
 * What the review step says it will sign: the first step stores the
 * treasury.spend call, and says which call, how much and to whom.
 */

vi.mock("@/components/create/voter-preview", () => ({ VoterPreview: () => <div /> }))

afterEach(cleanup)

const BENEFICIARY = "enAvhEMRnmzEJHSpJHBCQAh4AXNSeGjLFJEokqWybDvYnHfim"

function renderStage(over: Partial<Parameters<typeof Stage>[0]> = {}) {
  return render(
    <Stage
      draft={{
        ok: true,
        id: "11111111-2222-4333-8444-555555555555",
        json_url: "https://example.org/p.json",
        json_sha256: "ab".repeat(32),
        json_size_bytes: 321,
        remark_payload: "EGOV1:{}",
        proposal: {},
      }}
      title="Fund the client"
      summary="Maintenance and new features."
      body="Motivation: keep the client in sync with the runtime."
      amountFormatted="1,000 ENJ"
      amountPlanck={1_000n * 10n ** 18n}
      beneficiary={BENEFICIARY}
      beneficiaryName={null}
      track="Small Tipper"
      trackRaw="SmallTipper"
      chainName="Enjin Relaychain"
      network="enjin-relay"
      attachments={[]}
      callHex="0x0c05"
      preimageHash="0x80f6"
      preimageLen={46}
      preimageAlreadyNoted={false}
      metadataHash={null}
      enactmentText="as soon as it passes"
      costs={null}
      {...over}
    />,
  )
}

describe("Stage", () => {
  it("names the call the preimage holds, with its amount and beneficiary", async () => {
    const user = userEvent.setup()
    renderStage()
    await user.click(screen.getByRole("button", { name: /Register the proposal content/ }))
    expect(screen.getByText(/Stores the treasury\.spend call on chain/)).toBeTruthy()
    expect(screen.getByText(/the payout is claimed on the proposal page/)).toBeTruthy()
    const card = within(
      screen.getByRole("button", { name: /Register the proposal content/ }).closest("div")!
        .parentElement!,
    )
    expect(card.getByText("treasury.spend")).toBeTruthy()
    expect(card.getByText("1,000 ENJ")).toBeTruthy()
    expect(card.getByText(BENEFICIARY)).toBeTruthy()
    expect(card.queryByText("treasury.spendLocal")).toBeNull()
  })
})

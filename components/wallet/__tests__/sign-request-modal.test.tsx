// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { TxStatus } from "@/lib/query/hooks/use-tx"
import { SignRequestModal } from "../sign-request-modal"

/**
 * The sign-request modal is what a WalletConnect user sees while the wallet
 * on their phone signs. It carries the action in words (`subtitle`) and the
 * lifecycle - not the amount, conviction or track, which the user saw in the
 * panel and sees again in the wallet. These tests pin exactly what it shows.
 */

const delivery = vi.hoisted(() => ({ mobile: false, delivered: false, taps: 0 }))

vi.mock("@/lib/wallet/deep-link", () => ({ isMobileUserAgent: () => delivery.mobile }))
vi.mock("@/lib/wallet/request-delivery", () => ({
  isRequestDelivered: () => delivery.delivered,
  subscribeRequestDelivery: () => () => {},
  onWalletLinkTap: () => {
    delivery.taps += 1
    return true
  },
}))

type Props = Parameters<typeof SignRequestModal>[0]

function renderModal(status: TxStatus, props: Partial<Props> = {}) {
  const onClose = vi.fn()
  const onRetry = vi.fn()
  const view = render(
    <SignRequestModal
      open
      walletName="Enjin Wallet"
      walletIcon="/enjin.svg"
      subtitle="Approve the vote in your wallet"
      status={status}
      deepLinkUrl="enjinwallet://wc?requestId=1"
      onClose={onClose}
      onRetry={onRetry}
      {...props}
    />,
  )
  return { ...view, onClose, onRetry }
}

const dialog = () => screen.getByRole("dialog")

beforeEach(() => {
  delivery.mobile = false
  delivery.delivered = false
  delivery.taps = 0
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("SignRequestModal - before the signature", () => {
  it("shows nothing when closed", () => {
    const { container } = renderModal({ kind: "idle" }, { open: false })
    expect(container.innerHTML).toBe("")
  })

  it("names the wallet and the action, and nothing of the call itself", () => {
    renderModal({ kind: "signing" })
    expect(dialog().getAttribute("aria-label")).toBe("Sign with Enjin Wallet")
    expect(dialog().textContent).toBe(
      "Sign with Enjin WalletApprove the vote in your walletApprove the request in Enjin Wallet.",
    )
  })

  it("on a phone, holds the wallet link back until the relay has the request", async () => {
    delivery.mobile = true
    const first = renderModal({ kind: "signing" })
    expect(
      screen.getByRole("button", { name: "Open in Enjin Wallet" }).getAttribute("aria-disabled"),
    ).toBe("true")
    expect(screen.queryByRole("link", { name: "Open in Enjin Wallet" })).toBeNull()
    first.unmount()

    delivery.delivered = true
    renderModal({ kind: "signing" })
    const link = screen.getByRole("link", { name: "Open in Enjin Wallet" })
    expect(link.getAttribute("href")).toBe("enjinwallet://wc?requestId=1")
    await userEvent.setup().click(link)
    expect(delivery.taps).toBe(1)
  })

  it("has no wallet link on desktop", () => {
    delivery.delivered = true
    renderModal({ kind: "signing" })
    expect(screen.queryByRole("link", { name: /Open in/ })).toBeNull()
  })
})

describe("SignRequestModal - after the signature", () => {
  it("follows broadcast and inclusion", () => {
    const view = renderModal({ kind: "broadcast", txHash: "0xabc" })
    expect(dialog().textContent).toContain("Broadcasting your signed transaction…")
    view.rerender(
      <SignRequestModal
        open
        walletName="Enjin Wallet"
        walletIcon="/enjin.svg"
        subtitle="Approve the vote in your wallet"
        status={{ kind: "in-block", blockHash: "0xb", txHash: "0xabc" }}
        deepLinkUrl=""
        onClose={view.onClose}
      />,
    )
    expect(dialog().textContent).toContain("Included in a block - finalising on chain")
  })

  it("confirms at in-block when asked, with the explorer link and a finalising note", async () => {
    const { onClose } = renderModal(
      { kind: "in-block", blockHash: "0xb", txHash: "0xabc" },
      {
        successAt: "in-block",
        autoDismiss: false,
        successTitle: "Vote recorded on chain",
        successBody: "Thanks for shaping the future of Enjin.",
        explorerUrl: "https://enjin.subscan.io/extrinsic/0xabc",
      },
    )
    expect(dialog().textContent).toContain("Vote recorded on chain")
    expect(dialog().textContent).toContain("Finalising on chain…")
    expect(screen.getByRole("link", { name: "View on Subscan" }).getAttribute("href")).toBe(
      "https://enjin.subscan.io/extrinsic/0xabc",
    )
    await userEvent.setup().click(screen.getByRole("button", { name: "Done" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("waits for finality by default", () => {
    renderModal({ kind: "in-block", blockHash: "0xb", txHash: "0xabc" }, { successTitle: "Done!" })
    expect(dialog().textContent).not.toContain("Done!")
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull()
  })

  it("closes itself 2 s after inclusion unless told not to", () => {
    vi.useFakeTimers()
    const inBlock: TxStatus = { kind: "in-block", blockHash: "0xb", txHash: "0xabc" }
    const auto = renderModal(inBlock, { successAt: "in-block" })
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(auto.onClose).toHaveBeenCalledTimes(1)
    auto.unmount()

    const sticky = renderModal(inBlock, { successAt: "in-block", autoDismiss: false })
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(sticky.onClose).not.toHaveBeenCalled()
  })
})

describe("SignRequestModal - errors", () => {
  it("shows the error and retries on request", async () => {
    const { onRetry } = renderModal({ kind: "error", message: "Cancelled in wallet" })
    expect(dialog().textContent).toContain("Sign request didn't go through")
    expect(dialog().textContent).toContain("Cancelled in wallet")
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("offers no retry without a handler", () => {
    renderModal({ kind: "error", message: "x" }, { onRetry: undefined })
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
  })

  it("closes from the X and the backdrop", async () => {
    const user = userEvent.setup()
    const { onClose, container } = renderModal({ kind: "signing" })
    await user.click(screen.getByRole("button", { name: "Close" }))
    const backdrop = container.querySelector("[aria-hidden]")
    if (!(backdrop instanceof HTMLElement)) throw new Error("no backdrop")
    await user.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

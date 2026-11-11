import { describe, expect, it, vi } from "vitest"
import {
  onPageHidden,
  onPageVisible,
  refreshRelay,
  relayRefresh,
  resendOverNewSocket,
} from "@/lib/wallet/connectors/walletconnect"

/**
 * iOS suspends a page in the background and its relay socket dies without
 * a close event. The socket still looks connected, and in a browser the
 * SDK only finds out when a publish goes unanswered for 15 s. So a sign
 * request sent after coming back never reached the wallet ("Open in Enjin
 * Wallet" opened to nothing), and a signature given in the wallet took
 * that long to show on the page. Coming back replaces the socket; a
 * request the relay doesn't acknowledge is sent again over a new one.
 */

const client = (opts: { sessions?: number; proposals?: number; restart?: () => Promise<void> }) => {
  const restartTransport = vi.fn(opts.restart ?? (async () => undefined))
  return {
    restartTransport,
    core: { relayer: { restartTransport } },
    session: { getAll: () => Array.from({ length: opts.sessions ?? 0 }) },
    proposal: { getAll: () => Array.from({ length: opts.proposals ?? 0 }) },
  }
}

describe("coming back to the page", () => {
  it("keeps the socket after a short absence", () => {
    const c = client({ sessions: 1 })
    onPageHidden(10_000)
    expect(onPageVisible(c, 11_500)).toBe(false)
    expect(c.restartTransport).not.toHaveBeenCalled()
  })

  it("replaces the socket after a longer one, with a session connected", async () => {
    const c = client({ sessions: 1 })
    onPageHidden(10_000)
    expect(onPageVisible(c, 16_000)).toBe(true)
    await relayRefresh()
    expect(c.restartTransport).toHaveBeenCalledTimes(1)
    // Seen once: a second "visible" without having been away does nothing.
    expect(onPageVisible(c, 16_100)).toBe(false)
  })

  it("replaces it while a connection is being approved in the wallet", async () => {
    const c = client({ proposals: 1 })
    onPageHidden(0)
    expect(onPageVisible(c, 60_000)).toBe(true)
    await relayRefresh()
    expect(c.restartTransport).toHaveBeenCalledTimes(1)
  })

  it("leaves the relay alone when there is nothing to wait for", () => {
    const c = client({})
    onPageHidden(0)
    expect(onPageVisible(c, 60_000)).toBe(false)
    expect(c.restartTransport).not.toHaveBeenCalled()
  })
})

describe("replacing the relay socket", () => {
  it("runs one restart at a time", async () => {
    let finish = () => {}
    const c = client({ restart: () => new Promise<void>((r) => (finish = r)) })
    const first = refreshRelay(c)
    const second = refreshRelay(c)
    await Promise.resolve()
    await Promise.resolve()
    expect(c.restartTransport).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([first, second])
    // Once it is done, the next call starts a new one.
    const third = refreshRelay(c)
    await Promise.resolve()
    await Promise.resolve()
    expect(c.restartTransport).toHaveBeenCalledTimes(2)
    finish()
    await third
  })

  it("never throws, and gives up on a restart that hangs", async () => {
    const failing = client({
      restart: async () => {
        throw new Error("No internet connection detected")
      },
    })
    await expect(refreshRelay(failing)).resolves.toBeUndefined()
    const hanging = client({ restart: () => new Promise<void>(() => {}) })
    await expect(refreshRelay(hanging, 20)).resolves.toBeUndefined()
  })
})

describe("a sign request the relay has not acknowledged", () => {
  it("goes out again, as the same request, over a new socket", async () => {
    const c = client({})
    const redeliver = vi.fn(async () => true)
    expect(await resendOverNewSocket(c, () => false, redeliver)).toBe(true)
    expect(c.restartTransport).toHaveBeenCalledTimes(1)
    expect(redeliver).toHaveBeenCalledTimes(1)
    expect(c.restartTransport.mock.invocationCallOrder[0]).toBeLessThan(
      redeliver.mock.invocationCallOrder[0]!,
    )
  })

  it("is not sent again when the acknowledgement came during the restart", async () => {
    let acknowledged = false
    const c = client({
      restart: async () => {
        acknowledged = true
      },
    })
    const redeliver = vi.fn(async () => true)
    expect(await resendOverNewSocket(c, () => acknowledged, redeliver)).toBe(false)
    expect(redeliver).not.toHaveBeenCalled()
  })

  it("reports false when sending again fails", async () => {
    const redeliver = vi.fn(async (): Promise<boolean> => {
      throw new Error("publish failed")
    })
    expect(await resendOverNewSocket(client({}), () => false, redeliver)).toBe(false)
  })
})

import { describe, expect, it, vi } from "vitest"
import {
  onWalletConnectSessionGone,
  redeliverRequest,
  sweepGone,
  verifySession,
  watchTopic,
} from "@/lib/wallet/connectors/walletconnect"
import {
  clearRequestDelivered,
  markRequestDelivered,
  notePageHidden,
  onWalletLinkTap,
} from "@/lib/wallet/request-delivery"

/**
 * The page must never show a wallet as connected once the wallet has ended
 * the WalletConnect session (the site removed from Enjin Wallet's connected
 * apps) or it expired: every request would go to a session nobody answers,
 * and the wallet would show nothing. And a request the wallet lost is sent
 * again as the same request, never as a second one. Ported from Substreak.
 */

const TOPIC = "topic-enjin"
const live = () => Date.now() / 1000 + 3600

describe("a WalletConnect session the wallet ends", () => {
  it("is announced once when it disappears from the client", () => {
    const gone = vi.fn()
    const off = onWalletConnectSessionGone(gone)
    watchTopic(TOPIC)
    sweepGone({ session: { getAll: () => [{ topic: TOPIC, expiry: live() }] } })
    expect(gone).not.toHaveBeenCalled()
    sweepGone({ session: { getAll: () => [] } })
    sweepGone({ session: { getAll: () => [] } })
    expect(gone).toHaveBeenCalledTimes(1)
    expect(gone).toHaveBeenCalledWith(TOPIC, "deleted")
    off()
  })

  it("is announced as expired past its expiry", () => {
    const gone = vi.fn()
    const off = onWalletConnectSessionGone(gone)
    watchTopic("t2")
    sweepGone({ session: { getAll: () => [{ topic: "t2", expiry: Date.now() / 1000 - 1 }] } })
    expect(gone).toHaveBeenCalledWith("t2", "expired")
    off()
  })
})

describe("restoring a stored WalletConnect session", () => {
  const client = (
    topics: Array<{ topic: string; expiry: number }>,
    relay: { connected: boolean; open?: () => Promise<void> },
  ) => ({
    session: { getAll: () => topics },
    core: {
      relayer: {
        get connected() {
          return relay.connected
        },
        transportOpen: relay.open ?? (async () => undefined),
      },
    },
  })

  it("is ok when the relay is up and the session is still there after it delivered", async () => {
    const c = client([{ topic: TOPIC, expiry: live() }], { connected: true })
    expect(await verifySession(c, TOPIC, { settleMs: 1 })).toBe("ok")
  })

  it("is gone when the relay delivered the wallet's deletion", async () => {
    const topics = [{ topic: TOPIC, expiry: live() }]
    const relay = {
      connected: false,
      open: async () => {
        relay.connected = true
        topics.length = 0 // the pending wc_sessionDelete is processed on reconnect
      },
    }
    expect(await verifySession(client(topics, relay), TOPIC, { settleMs: 1 })).toBe("gone")
  })

  it("is unreachable, not gone, when the relay cannot be reached", async () => {
    const relay = {
      connected: false,
      open: async () => {
        throw new Error("socket closed")
      },
    }
    const c = client([{ topic: TOPIC, expiry: live() }], relay)
    expect(await verifySession(c, TOPIC, { settleMs: 1 })).toBe("unreachable")
  })

  it("is expired past its expiry, without asking the relay", async () => {
    const c = client([{ topic: TOPIC, expiry: Date.now() / 1000 - 5 }], { connected: false })
    expect(await verifySession(c, TOPIC)).toBe("expired")
  })
})

describe("re-delivering a sign request", () => {
  it("publishes the same pending request again, and nothing once it is answered", async () => {
    const request = { id: 42, jsonrpc: "2.0", method: "wc_sessionRequest", params: {} }
    const pending = [{ topic: TOPIC, request }]
    const publish = vi.fn(async () => undefined)
    const fake = {
      core: {
        history: { pending },
        crypto: { encode: async (_t: string, r: unknown) => `enc:${JSON.stringify(r)}` },
        relayer: { publish },
      },
    } as unknown as Parameters<typeof redeliverRequest>[0]

    expect(await redeliverRequest(fake, TOPIC, "42")).toBe(true)
    expect(publish).toHaveBeenCalledWith(
      TOPIC,
      `enc:${JSON.stringify(request)}`,
      expect.objectContaining({ tag: 1108, prompt: true }),
    )
    pending.length = 0
    expect(await redeliverRequest(fake, TOPIC, "42")).toBe(false)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it("a first tap only opens the wallet; a tap after coming back re-delivers", () => {
    const redeliver = vi.fn(async () => true)
    markRequestDelivered(TOPIC, redeliver)
    expect(onWalletLinkTap()).toBe(false) // opens the wallet
    expect(onWalletLinkTap()).toBe(false) // double tap, never left the page
    notePageHidden() // went to the wallet, came back without an answer
    expect(onWalletLinkTap()).toBe(true)
    expect(redeliver).toHaveBeenCalledTimes(1)
    clearRequestDelivered(TOPIC)
    expect(onWalletLinkTap()).toBe(false)
  })
})

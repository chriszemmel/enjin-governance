/**
 * Relays the browser's chain WebSockets through Node.
 *
 * Some sandboxes (the one these tests were written in, for one) put
 * Chromium behind a proxy that refuses WebSocket upgrades, while Node
 * reaches the RPC fine. Relaying keeps the chain data real either way; on
 * a runner with direct access (GitHub Actions) it is a plain pass-through.
 * Set E2E_WS_RELAY=0 to let the browser connect directly instead.
 */
import type { BrowserContext } from "@playwright/test"

/** Canary Relay RPC and archive node: the only outside hosts the tests use. */
const CANARY_RELAY = /^wss:\/\/(rpc|archive)\.relay\.canary\.enjin\.io(\/|$)/

export const relayEnabled = process.env.E2E_WS_RELAY !== "0"

/** Returns a function that closes every upstream socket still open. */
export async function relayChainSockets(context: BrowserContext): Promise<() => void> {
  const open = new Set<WebSocket>()
  await context.routeWebSocket(CANARY_RELAY, (browserSide) => {
    // Node 22's built-in WebSocket client.
    const upstream = new WebSocket(browserSide.url())
    upstream.binaryType = "arraybuffer"
    open.add(upstream)
    const pending: (string | Buffer)[] = []
    upstream.addEventListener("open", () => {
      for (const message of pending.splice(0)) upstream.send(message)
    })
    upstream.addEventListener("message", (event) => {
      const data = event.data as string | ArrayBuffer
      browserSide.send(typeof data === "string" ? data : Buffer.from(data))
    })
    upstream.addEventListener("close", () => {
      open.delete(upstream)
      browserSide.close().catch(() => {})
    })
    // A failed connection is followed by "close"; the app reconnects itself.
    upstream.addEventListener("error", () => {})
    browserSide.onMessage((message) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(message)
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push(message)
    })
    browserSide.onClose(() => upstream.close())
  })
  return () => {
    for (const socket of open) socket.close()
    open.clear()
  }
}

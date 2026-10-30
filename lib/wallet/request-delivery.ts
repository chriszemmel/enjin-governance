/**
 * The WalletConnect sign request this page has open in the wallet, per
 * session topic: whether it has reached the relay, and a way to send that
 * same request again.
 *
 * The "Open in <wallet>" link waits for delivery: tapped earlier, the page
 * goes to the background while the request is still being sent (iOS
 * suspends it there), and the wallet opens to nothing.
 *
 * One tap, one request. The first tap only opens the wallet. A later tap,
 * after the person was in the wallet and came back without an answer,
 * re-delivers the very same request (same id, same payload), because Enjin
 * Wallet sometimes loses one; the wallet sees that id again, never a second
 * request. A double tap without leaving the page re-delivers nothing.
 *
 * Set by the connector when the relay acknowledges the request, cleared when
 * the wallet answers or the request fails.
 */

const delivered = new Set<string>()
const redeliverers = new Map<string, () => Promise<boolean>>()
const listeners = new Set<() => void>()
/** Topics whose wallet link was tapped since the request went out. */
const opened = new Set<string>()
/** The page was hidden (the person went to the wallet) since the last tap. */
let awaySinceTap = false
let watchingVisibility = false

function emit(): void {
  for (const l of [...listeners]) l()
}

function watchVisibility(): void {
  if (watchingVisibility || typeof document === "undefined") return
  watchingVisibility = true
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") notePageHidden()
  })
}

/** The page went to the background (from a visibilitychange listener; exported for tests). */
export function notePageHidden(): void {
  awaySinceTap = true
}

export function markRequestDelivered(topic: string, redeliver?: () => Promise<boolean>): void {
  if (redeliver) redeliverers.set(topic, redeliver)
  if (delivered.has(topic)) return
  delivered.add(topic)
  emit()
}

export function clearRequestDelivered(topic: string): void {
  redeliverers.delete(topic)
  opened.delete(topic)
  if (delivered.delete(topic)) emit()
}

/** Whether a sign request is waiting in the wallet (one wallet session at a time). */
export function isRequestDelivered(): boolean {
  return delivered.size > 0
}

/**
 * Called from a tap on the wallet link (the deep link is the link's own
 * navigation). Returns whether it re-delivered the open request.
 */
export function onWalletLinkTap(): boolean {
  watchVisibility()
  const topic = [...delivered][0]
  if (!topic) return false
  if (!opened.has(topic)) {
    opened.add(topic)
    awaySinceTap = false
    return false
  }
  if (!awaySinceTap) return false
  awaySinceTap = false
  const redeliver = redeliverers.get(topic)
  if (!redeliver) return false
  void redeliver().catch(() => false)
  return true
}

/** For `useSyncExternalStore`. */
export function subscribeRequestDelivery(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

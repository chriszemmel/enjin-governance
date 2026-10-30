/**
 * Which WalletConnect sessions have a sign request that has reached the
 * relay. The "Open in <wallet>" link waits for it: tapped earlier, the
 * page goes to the background while the request is still being sent (iOS
 * suspends it there), and the wallet opens to nothing.
 *
 * Set by the connector when the relay acknowledges the request, cleared
 * when the wallet answers or the request fails.
 */

const delivered = new Set<string>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of [...listeners]) l()
}

export function markRequestDelivered(topic: string): void {
  if (delivered.has(topic)) return
  delivered.add(topic)
  emit()
}

export function clearRequestDelivered(topic: string): void {
  if (delivered.delete(topic)) emit()
}

/** Whether a sign request is waiting in the wallet (one wallet session at a time). */
export function isRequestDelivered(): boolean {
  return delivered.size > 0
}

/** For `useSyncExternalStore`. */
export function subscribeRequestDelivery(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

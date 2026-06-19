"use client"

/**
 * Mobile deep-link into Enjin Wallet. The wallet registers the
 * `enjinwallet://` scheme and accepts a `wc` URI as the connection target.
 *
 * The OS shows a "Open in app" prompt if the wallet is installed; if not,
 * nothing happens (mobile Safari) or you land on a "page not found" screen
 * (Chrome). We surface the deep-link as one of two CTAs alongside the QR
 * so desktop + mobile users both have a path.
 */

const ENJIN_WALLET_DEEP_LINK_SCHEME = "enjinwallet"

export function buildEnjinWalletDeepLink(connectionUri: string): string {
  return `${ENJIN_WALLET_DEEP_LINK_SCHEME}://wc?uri=${encodeURIComponent(connectionUri)}`
}

/**
 * Build the deep link used by the sign-request modal - same `enjinwallet://wc?…`
 * shape the pair flow uses, but parameterised by the active session topic
 * instead of a pairing URI. We don't have the per-request id from this
 * layer (it's allocated inside signClient.request), so sessionTopic is the
 * strongest hint we can give the wallet about which channel this is for;
 * the actual request itself follows over the WC relay.
 */
export function buildSignRequestDeepLink(opts: {
  peerRedirect?: string | null
  sessionTopic?: string | null
}): string {
  const base = opts.peerRedirect ?? `${ENJIN_WALLET_DEEP_LINK_SCHEME}://`
  const baseNoSlash = base.endsWith("/") ? base.slice(0, -1) : base
  if (!opts.sessionTopic) return base
  return `${baseNoSlash}/wc?sessionTopic=${encodeURIComponent(opts.sessionTopic)}`
}

export function isMobileUserAgent(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "")
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
}

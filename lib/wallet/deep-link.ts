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
 * Deep link used while a sign request is pending: only the wallet itself
 * (`enjinwallet://`, or the redirect the wallet announced). The request
 * reaches the wallet over the WalletConnect relay; a link that named the
 * session (`wc?sessionTopic=...`) made Enjin Wallet fetch it a second time,
 * and an iPhone showed two requests for one (seen in Substreak on a real
 * device, 2026-10-01). The topic stays in the signature for callers.
 */
export function buildSignRequestDeepLink(opts: {
  peerRedirect?: string | null
  sessionTopic?: string | null
}): string {
  return opts.peerRedirect ?? `${ENJIN_WALLET_DEEP_LINK_SCHEME}://`
}

export function isMobileUserAgent(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "")
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
}

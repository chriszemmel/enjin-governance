/**
 * Coerce anything thrown / rejected into a human-readable string for
 * toast descriptions, log lines, etc. Handles the common shapes we
 * see in practice:
 *
 *   - Error                                  → e.message
 *   - { message: string }                    → message
 *   - { error: string }                      → error
 *   - { reason: string }                     → reason
 *   - { code, message }  (WalletConnect)     → friendly text per code,
 *                                              falling back to message alone
 *   - other objects                          → JSON.stringify(e)
 *   - everything else                        → String(e)
 *
 * Without this, plain-object rejections (notably WC v2's
 * `{ code, message }` shape) hit `String({})` and render as the
 * useless literal "[object Object]" in toasts.
 */
export function formatError(e: unknown): string {
  if (e == null) return "Unknown error"
  if (typeof e === "string") return e
  if (e instanceof Error) {
    return e.message || e.name || "Unknown error"
  }
  if (typeof e === "object") {
    const o = e as Record<string, unknown>
    const message =
      pickString(o.message) ??
      pickString(o.error) ??
      pickString(o.reason) ??
      pickString(o.detail) ??
      pickString(o.description)
    const code = pickNumber(o.code) ?? toNumber(pickString(o.code))
    if (code != null) {
      const friendly = friendlyWalletConnectError(code, message)
      if (friendly) return friendly
    }
    if (message) return message
    try {
      const json = JSON.stringify(e)
      if (json && json !== "{}") return json
    } catch {
      /* fall through */
    }
  }
  try {
    return String(e)
  } catch {
    return "Unknown error"
  }
}

/**
 * Translate WalletConnect / Enjin Wallet rejection codes into text a
 * non-technical user can act on. The WC v2 SDK uses small codes
 * (5 USER_REJECTED, 6 EXPIRED, 7 SESSION_SETTLEMENT_FAILED). The Enjin
 * Wallet's own rejection from the in-wallet sign sheet surfaces as
 * code 5000 - not part of the SDK constants, but consistent. Returns
 * null when we don't recognise the code so the caller can fall back
 * to the raw message.
 */
function friendlyWalletConnectError(
  code: number,
  message: string | undefined,
): string | null {
  // `\n` is rendered as a line break by SignRequestModal's body (it
  // applies `whitespace-pre-line`). The break sits between the cause
  // line and the call-to-action so the Retry hint doesn't crowd onto
  // the same row as the explanation.
  switch (code) {
    case 5:
    case 5000:
      return "The wallet rejected the request.\nTap Retry to try again."
    case 5001:
      return "The wallet hasn't approved this network for this session. Disconnect and reconnect to approve it."
    case 5002:
      return "The wallet hasn't approved this signing method for this session. Disconnect and reconnect."
    case 6:
    case 5300:
      return "The request expired before the wallet approved it.\nTap Retry to send a fresh one."
    case 7:
      return "The wallet couldn't settle the connection. Reconnect your wallet and try again."
    default:
      if (code >= 5000 && code < 6000 && message) {
        return `${message}\nTap Retry to try again.`
      }
      return null
  }
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}
function pickNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}
function toNumber(v: string | undefined): number | undefined {
  if (!v) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Structured variant of the above for page-level error states (as opposed
 * to single-line toasts). Maps a raw error onto a friendly headline +
 * detail, preserving the original message in `technical` so a "show
 * technical details" disclosure can surface it.
 */
export type FriendlyError = {
  headline: string
  detail: string
  technical: string | null
}

const NETWORK_PATTERNS = [
  /WebSocket is not connected/i,
  /websocket/i,
  /Connection failed/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /Load failed/i,
]

const TIMEOUT_PATTERNS = [/timeout/i, /timed out/i]

const NOT_READY_PATTERNS = [/API not ready/i, /Api not initialised/i, /Disconnected/i]

export function friendlyError(err: unknown): FriendlyError {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : err == null
          ? ""
          : safeStringify(err)

  if (NOT_READY_PATTERNS.some((p) => p.test(raw))) {
    return {
      headline: "Connecting…",
      detail: "Still establishing a connection to the chain. Try again in a moment.",
      technical: raw || null,
    }
  }

  if (NETWORK_PATTERNS.some((p) => p.test(raw))) {
    return {
      headline: "Couldn't reach the chain",
      detail: "Check your internet connection, then try again.",
      technical: raw || null,
    }
  }

  if (TIMEOUT_PATTERNS.some((p) => p.test(raw))) {
    return {
      headline: "Connection timed out",
      detail: "The chain didn't respond in time. Try again in a moment.",
      technical: raw || null,
    }
  }

  return {
    headline: "Something went wrong",
    detail: "We hit an error loading this. Try again in a moment.",
    technical: raw || null,
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

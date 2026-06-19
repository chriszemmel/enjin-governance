/**
 * Sign-In-With-Polkadot style auth. The flow:
 *
 *   1. Client requests a nonce for an address via /api/auth/nonce.
 *      Server generates a 16-byte random nonce (32 hex chars), stashes it in the
 *      `auth_nonces` Postgres table with a 30-minute TTL, and returns
 *      the nonce plus the exact message bytes the client should sign.
 *   2. Client signs the message via polkadot_signMessage and POSTs the
 *      address + message + signature to /api/auth/verify.
 *   3. Server checks (a) the nonce is current, (b) the signature is
 *      valid for the address, then issues an opaque bearer token and
 *      stores its sha256 in the wallet_sessions table. The token is
 *      sent back as an HttpOnly cookie.
 *
 * Verification is via @polkadot/util-crypto's signatureVerify which
 * accepts any SS58 prefix - so a `cn…` canary address signs and is
 * verified identically to an `en…` mainnet one.
 *
 * Nonce persistence lives in `lib/db/auth-nonces.ts`. This module is
 * only the pure-crypto layer: message format + signature verification
 * + bearer token minting.
 */

import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { signatureVerify, cryptoWaitReady } from "@polkadot/util-crypto"
import { stringToHex, stringToU8a } from "@polkadot/util"

let cryptoReady: Promise<void> | null = null
async function ensureCrypto(): Promise<void> {
  if (!cryptoReady) {
    cryptoReady = cryptoWaitReady().then(() => undefined)
  }
  await cryptoReady
}

// 30-minute TTL. Long enough to absorb the round-trip from a slow
// mobile sign - open wallet, read the prompt, sign, switch back to
// Safari - even when the tab was backgrounded the whole time and the
// client-side prefetch's refetchInterval was paused. The nonce is a
// single-use 16-byte secret so a longer window doesn't widen the
// attack surface meaningfully.
export const NONCE_TTL_MS = 30 * 60_000

export const SESSION_COOKIE = "enjin-governance:session"
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000 // 30 days

export function buildSiweMessage(address: string, nonce: string): string {
  return [
    "Enjin Governance - sign in",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date().toISOString()}`,
    "",
    "Signing this message proves you control the address.",
    "It does not authorise any on-chain transaction.",
  ].join("\n")
}

/**
 * Mint a fresh nonce + message pair. The caller is responsible for
 * persisting the (nonce, address, message, expiresAt) tuple - that
 * lives in `lib/db/auth-nonces.ts` so this module stays free of DB
 * dependencies (and remains unit-testable without a database).
 */
export function freshNonce(): { nonce: string; expiresAt: Date } {
  return {
    nonce: randomBytes(16).toString("hex"),
    expiresAt: new Date(Date.now() + NONCE_TTL_MS),
  }
}

/**
 * Verify a polkadot signature against an SS58 address. Returns true
 * when the signature was produced by the private key for that
 * address regardless of which network's prefix the address uses.
 *
 * Polkadot wallets that handle `signRaw({ type: "bytes" })` wrap the
 * payload in `<Bytes>…</Bytes>` tags before signing - that's the
 * polkadot-js extension convention and Enjin Wallet follows it. We
 * try the wrapped form first (the common case) and fall back to the
 * plain form so wallets that don't wrap still verify.
 */
export async function verifySignature(
  message: string,
  signature: string,
  address: string,
): Promise<boolean> {
  await ensureCrypto()
  // Try every reasonable interpretation of what the wallet could have
  // signed. Different wallets and different transports (browser
  // extension vs WalletConnect) wrap and encode the payload in
  // slightly different ways:
  //   - `<Bytes>${message}</Bytes>` - polkadot-js extension convention;
  //     Enjin Wallet follows the same wrap.
  //   - plain `message` - some wallets skip the wrap entirely.
  //   - the same shapes but with the 0x-hex form of the message -
  //     covers wallets that receive `polkadot_signMessage` as hex and
  //     sign the literal hex string rather than decoding it first.
  //
  // u8a-typed candidates dodge signatureVerify's auto-detect-hex
  // behaviour, which would otherwise re-decode a string starting with
  // "0x" back to its byte form (collapsing two candidates into one).
  const hex = stringToHex(message)
  const candidates: Array<string | Uint8Array> = [
    `<Bytes>${message}</Bytes>`,
    message,
    stringToU8a(`<Bytes>${hex}</Bytes>`),
    stringToU8a(hex),
  ]
  for (const candidate of candidates) {
    try {
      if (signatureVerify(candidate, signature, address).isValid) {
        return true
      }
    } catch {
      // Try the next candidate.
    }
  }
  return false
}

export function mintSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex")
  const tokenHash = createHash("sha256").update(token).digest("hex")
  return { token, tokenHash }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

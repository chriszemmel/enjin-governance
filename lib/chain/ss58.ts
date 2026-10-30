/**
 * SS58 address utilities for the Polkadot SDK chains we touch.
 *
 * - `initializeWasm`: idempotent WASM bootstrap. Must run once before any
 *   encode/decode/sign/verify on the server. The browser bundle initializes
 *   on import so calling it is a no-op there too.
 * - `isValidSs58`: format-only check (doesn't verify it's on a specific chain).
 * - `isValidAddressForChain`: format + prefix check against a specific chain.
 * - `encodeForChain`: re-encode an address to the chain's SS58 prefix
 *   (useful when a wallet returns the address with a different prefix).
 * - `shortenAddress`: display helper (don't use for matching).
 */

import {
  base58Decode,
  checkAddressChecksum,
  cryptoWaitReady,
  decodeAddress,
  encodeAddress,
} from "@polkadot/util-crypto"
import { hexToU8a } from "@polkadot/util"
import { type ChainId, getChain } from "./chains"

let wasmReady: Promise<void> | null = null

/**
 * Initialize the @polkadot/util-crypto WASM module. Idempotent.
 *
 * Call once per process / page load before invoking any address helpers in
 * a serverless context. In the browser the WASM auto-initializes on import,
 * so this just resolves immediately on the second call.
 */
export async function initializeWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = cryptoWaitReady().then(() => undefined)
  }
  await wasmReady
}

/** Decode an SS58 address to its 32-byte public key as a hex string. */
export function publicKeyOf(address: string): string {
  const bytes = decodeAddress(address)
  return Buffer.from(bytes).toString("hex")
}

/**
 * True when two SS58 strings encode the same underlying public key,
 * regardless of which chain's prefix they use. The canonical "is this
 * the same wallet?" check - needed because a user can connect the
 * same key on multiple chains and our DB stores whichever prefix the
 * wallet handed back at the time.
 */
export function samePublicKey(a: string, b: string): boolean {
  if (a === b) return true
  try {
    const ba = decodeAddress(a)
    const bb = decodeAddress(b)
    if (ba.length !== bb.length) return false
    for (let i = 0; i < ba.length; i += 1) {
      if (ba[i] !== bb[i]) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Strict SS58 format check. Does not verify the prefix matches any
 * particular chain - use isValidAddressForChain() for that.
 *
 * decodeAddress() will also accept raw hex strings as pubkeys. We enforce
 * the result is exactly 32 bytes so that arbitrary hex like "0xdeadbeef"
 * doesn't pass.
 */
export function isValidSs58(address: string): boolean {
  try {
    const bytes = decodeAddress(address)
    return bytes.length === 32
  } catch {
    return false
  }
}

/**
 * Verify an address is valid AND encoded with the SS58 prefix the chain expects.
 * Catches the common mistake of a Polkadot-prefixed address (prefix 0) being
 * pasted into a field that expects an Enjin Relay address (prefix 2135).
 */
export function isValidAddressForChain(address: string, chainId: ChainId): boolean {
  if (!isValidSs58(address)) return false
  const chain = getChain(chainId)
  try {
    const reencoded = encodeAddress(decodeAddress(address), chain.ss58Prefix)
    return reencoded === address
  } catch {
    return false
  }
}

/**
 * Re-encode a valid SS58 address using the chain's prefix.
 *
 * Use this when a wallet hands back an address in some other prefix (e.g.
 * Polkadot-prefix `1...` from the extension) and you need to display or
 * use it as an Enjin Relay-prefix `en...` address.
 */
export function encodeForChain(address: string, chainId: ChainId): string {
  const chain = getChain(chainId)
  const bytes = decodeAddress(address)
  return encodeAddress(bytes, chain.ss58Prefix)
}

/**
 * Encode a 32-byte hex public key (e.g. "0xeabc…") as an SS58 address
 * for the given chain. Subscan sometimes returns beneficiaries as raw
 * pubkeys inside `{Id: "0x…"}` envelopes - this turns them back into
 * `en…` addresses for display.
 */
export function encodePublicKeyForChain(hexPubkey: string, chainId: ChainId): string {
  const chain = getChain(chainId)
  return encodeAddress(hexToU8a(hexPubkey), chain.ss58Prefix)
}

/** SS58 prefixes we can name when an address comes in another format. */
const SS58_NETWORK_LABELS: Record<number, string> = {
  0: "Polkadot",
  2: "Kusama",
  42: "generic Substrate",
  69: "Canary Relaychain",
  1110: "Enjin Matrixchain",
  2135: "Enjin Relaychain",
  9030: "Canary Matrixchain",
}

export type AddressInspection =
  | { status: "empty" }
  | { status: "invalid" }
  /** Valid and already in this chain's format. */
  | { status: "native"; address: string }
  /**
   * Valid, but in another network's format (or a raw public key). `address`
   * is the same key re-encoded for this chain - what would actually be paid.
   */
  | { status: "foreign"; input: string; networkLabel: string; address: string }

/**
 * Classify what someone typed into an address field. Unlike
 * `encodeForChain`, this never converts silently: a valid address in
 * another network's format comes back as "foreign" with the matching
 * address for this chain, so the UI can ask before converting.
 */
export function inspectAddress(raw: string, chainId: ChainId): AddressInspection {
  const input = raw.trim()
  if (!input) return { status: "empty" }
  const chain = getChain(chainId)

  if (/^0x[0-9a-fA-F]{64}$/.test(input)) {
    return {
      status: "foreign",
      input,
      networkLabel: "raw public key",
      address: encodeAddress(hexToU8a(input), chain.ss58Prefix),
    }
  }

  let prefix: number
  try {
    const [valid, , , decodedPrefix] = checkAddressChecksum(base58Decode(input))
    if (!valid || !isValidSs58(input)) return { status: "invalid" }
    prefix = decodedPrefix
  } catch {
    return { status: "invalid" }
  }

  if (prefix === chain.ss58Prefix) return { status: "native", address: input }
  return {
    status: "foreign",
    input,
    networkLabel: SS58_NETWORK_LABELS[prefix] ?? `another network (prefix ${prefix})`,
    address: encodeForChain(input, chainId),
  }
}

/**
 * Display-only truncation: "enD9wd...7dX4iA". Never use for matching -
 * always compare full SS58 strings (or their public-key bytes).
 */
export function shortenAddress(address: string, leadChars = 6, trailChars = 6): string {
  if (address.length <= leadChars + trailChars + 3) return address
  return `${address.slice(0, leadChars)}...${address.slice(-trailChars)}`
}

/**
 * Which network an address belongs to, and which ones can sign in.
 *
 * Users are per network (scripts/009): the same key as an Enjin Relay
 * (en…) and a Canary (cn…) address is two users, and handles are unique
 * per network. The network is read from the address's exact SS58 prefix,
 * not its first letters - other prefixes share them (2134 also starts
 * "ef"), and Canary Matrix addresses start "cx", not "cm".
 *
 * Sign-in only takes the formats of the networks the site runs on (the
 * enabled chains, today the two relay chains). The browser re-encodes
 * whatever the wallet shows - a generic 5… address, a Polkadot 1… one - to
 * the active network's format before it asks for a nonce
 * (lib/query/hooks/use-session.ts), so every wallet still works. Refusing
 * other formats on the server keeps a key from making extra users that
 * have no network and so sit outside the per-network handle uniqueness.
 *
 * Call `initializeWasm()` (lib/chain/ss58) first on the server.
 */

import { base58Decode, checkAddressChecksum, encodeAddress } from "@polkadot/util-crypto"
import { CHAINS, type ChainId } from "@/lib/chain/chains"
import { isValidSs58 } from "@/lib/chain/ss58"

/** The chain whose SS58 prefix this address uses, or null (unknown, invalid, raw key). */
export function networkOfAddress(address: string): ChainId | null {
  // isValidSs58 also takes a 0x public key; base58Decode then refuses it.
  if (!isValidSs58(address)) return null
  let prefix: number
  try {
    const [valid, , , decoded] = checkAddressChecksum(base58Decode(address))
    if (!valid) return null
    prefix = decoded
  } catch {
    return null
  }
  return Object.values(CHAINS).find((c) => c.ss58Prefix === prefix)?.id ?? null
}

/** The network a sign-in with this address is for, or null when it can't sign in. */
export function signInNetworkOf(address: string): ChainId | null {
  const network = networkOfAddress(address)
  return network && CHAINS[network].enabled ? network : null
}

/** "Sign in with your Enjin Relaychain (en…) or Canary Relaychain (cn…) address." */
export function signInFormatError(): string {
  const formats = Object.values(CHAINS)
    .filter((c) => c.enabled)
    .map((c) => `${c.name} (${encodeAddress(new Uint8Array(32), c.ss58Prefix).slice(0, 2)}…)`)
  return `Sign in with your ${formats.join(" or ")} address.`
}

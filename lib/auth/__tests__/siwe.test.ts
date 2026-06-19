import { describe, expect, it } from "vitest"
import {
  cryptoWaitReady,
  encodeAddress,
  randomAsU8a,
  sr25519PairFromSeed,
  sr25519Sign,
} from "@polkadot/util-crypto"
import { stringToU8a, u8aToHex } from "@polkadot/util"
import {
  buildSiweMessage,
  freshNonce,
  verifySignature,
} from "@/lib/auth/siwe"

type Pair = {
  publicKey: Uint8Array
  sign: (data: Uint8Array) => `0x${string}`
}

async function freshPair(): Promise<Pair> {
  await cryptoWaitReady()
  const { publicKey, secretKey } = sr25519PairFromSeed(randomAsU8a(32))
  return {
    publicKey,
    sign: (data) => u8aToHex(sr25519Sign(data, { publicKey, secretKey })),
  }
}

describe("siwe signature verification", () => {
  it("verifies the exact message bytes the wallet signed (polkadot-js <Bytes> wrap)", async () => {
    const pair = await freshPair()
    const address = encodeAddress(pair.publicKey, 69) // canary relay (cn…)
    const { nonce } = freshNonce()
    const message = buildSiweMessage(address, nonce)
    // Polkadot-js wallets wrap signRaw payloads in `<Bytes>…</Bytes>`.
    const signature = pair.sign(stringToU8a(`<Bytes>${message}</Bytes>`))

    expect(await verifySignature(message, signature, address)).toBe(true)
  })

  it("verifies a plain (unwrapped) signature too", async () => {
    const pair = await freshPair()
    const address = encodeAddress(pair.publicKey, 69)
    const { nonce } = freshNonce()
    const message = buildSiweMessage(address, nonce)
    const signature = pair.sign(stringToU8a(message))

    expect(await verifySignature(message, signature, address)).toBe(true)
  })

  it("verifies a Canary-prefix (cn…) signature against an Enjin-prefix (en…) address - same pubkey, different SS58 encoding", async () => {
    const pair = await freshPair()
    const canaryAddress = encodeAddress(pair.publicKey, 69)
    const enjinAddress = encodeAddress(pair.publicKey, 2135)
    const { nonce } = freshNonce()
    const message = buildSiweMessage(canaryAddress, nonce)
    const signature = pair.sign(stringToU8a(`<Bytes>${message}</Bytes>`))

    // The failure this guards against: if verifySignature were
    // prefix-sensitive at the string level instead of pubkey-level,
    // this would fail. It must pass - the signature is over the
    // bytes, and both SS58 encodings decode to the same public key.
    expect(await verifySignature(message, signature, enjinAddress)).toBe(true)
  })

  it("rejects a signature from the wrong key", async () => {
    const a = await freshPair()
    const b = await freshPair()
    const addrA = encodeAddress(a.publicKey, 69)
    const { nonce } = freshNonce()
    const message = buildSiweMessage(addrA, nonce)
    const signatureFromB = b.sign(stringToU8a(`<Bytes>${message}</Bytes>`))

    expect(await verifySignature(message, signatureFromB, addrA)).toBe(false)
  })
})

describe("freshNonce", () => {
  it("returns a 32-char hex nonce with a future expiry", () => {
    const { nonce, expiresAt } = freshNonce()
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it("never collides across successive calls", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i += 1) {
      const { nonce } = freshNonce()
      expect(seen.has(nonce)).toBe(false)
      seen.add(nonce)
    }
  })
})

import { beforeAll, describe, expect, it } from "vitest"
import {
  encodeForChain,
  inspectAddress,
  initializeWasm,
  isValidAddressForChain,
  isValidSs58,
  publicKeyOf,
  samePublicKey,
  shortenAddress,
} from "@/lib/chain/ss58"

// Canonical known-good test addresses (same 32-byte pubkey, different prefixes).
// Treasury accounts make convenient fixtures because they're stable and on-chain.
const ENJIN_RELAY_TREASURY = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const MATRIX_COMMUNITY_WALLET = "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH"

beforeAll(async () => {
  await initializeWasm()
})

describe("isValidSs58", () => {
  it("accepts well-formed Enjin Relay addresses", () => {
    expect(isValidSs58(ENJIN_RELAY_TREASURY)).toBe(true)
  })

  it("accepts well-formed Matrix addresses", () => {
    expect(isValidSs58(MATRIX_COMMUNITY_WALLET)).toBe(true)
  })

  it("rejects garbage", () => {
    expect(isValidSs58("")).toBe(false)
    expect(isValidSs58("not-an-address")).toBe(false)
    expect(isValidSs58("0xdeadbeef")).toBe(false)
    expect(isValidSs58("enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4Z9")).toBe(false)
  })
})

describe("isValidAddressForChain", () => {
  it("accepts the Enjin Relay treasury as an enjin-relay address", () => {
    expect(isValidAddressForChain(ENJIN_RELAY_TREASURY, "enjin-relay")).toBe(true)
  })

  it("rejects the Matrix community wallet as an enjin-relay address", () => {
    // Same pubkey, wrong prefix - must fail the chain check.
    expect(isValidAddressForChain(MATRIX_COMMUNITY_WALLET, "enjin-relay")).toBe(false)
  })

  it("accepts the Matrix community wallet as an enjin-matrix address", () => {
    expect(isValidAddressForChain(MATRIX_COMMUNITY_WALLET, "enjin-matrix")).toBe(true)
  })

  it("rejects garbage everywhere", () => {
    expect(isValidAddressForChain("not-an-address", "enjin-relay")).toBe(false)
  })
})

describe("encodeForChain", () => {
  it("re-encodes a Matrix address as Enjin Relay (and vice versa)", () => {
    const asRelay = encodeForChain(MATRIX_COMMUNITY_WALLET, "enjin-relay")
    expect(asRelay.startsWith("en")).toBe(true)
    expect(isValidAddressForChain(asRelay, "enjin-relay")).toBe(true)

    // Round-trip: same underlying pubkey
    expect(publicKeyOf(asRelay)).toBe(publicKeyOf(MATRIX_COMMUNITY_WALLET))

    const backToMatrix = encodeForChain(asRelay, "enjin-matrix")
    expect(backToMatrix).toBe(MATRIX_COMMUNITY_WALLET)
  })

  it("is a no-op when input already matches the target prefix", () => {
    expect(encodeForChain(ENJIN_RELAY_TREASURY, "enjin-relay")).toBe(ENJIN_RELAY_TREASURY)
  })
})

describe("publicKeyOf", () => {
  it("returns a 64-char hex string for a valid address", () => {
    const pubkey = publicKeyOf(ENJIN_RELAY_TREASURY)
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it("returns the same pubkey for the same identity across chain prefixes", () => {
    const asRelay = encodeForChain(MATRIX_COMMUNITY_WALLET, "enjin-relay")
    expect(publicKeyOf(asRelay)).toBe(publicKeyOf(MATRIX_COMMUNITY_WALLET))
  })
})

describe("samePublicKey", () => {
  it("matches the same address across different SS58 prefixes", () => {
    const asMatrix = MATRIX_COMMUNITY_WALLET
    const asRelay = encodeForChain(asMatrix, "enjin-relay")
    expect(samePublicKey(asMatrix, asRelay)).toBe(true)
  })

  it("returns true on byte-identical inputs", () => {
    expect(samePublicKey(ENJIN_RELAY_TREASURY, ENJIN_RELAY_TREASURY)).toBe(true)
  })

  it("returns false on different public keys", () => {
    expect(samePublicKey(ENJIN_RELAY_TREASURY, MATRIX_COMMUNITY_WALLET)).toBe(false)
  })

  it("returns false on garbage inputs", () => {
    expect(samePublicKey("not-an-address", ENJIN_RELAY_TREASURY)).toBe(false)
    expect(samePublicKey("", ENJIN_RELAY_TREASURY)).toBe(false)
  })
})

describe("shortenAddress", () => {
  it("truncates with ellipsis using 6+6 by default", () => {
    expect(shortenAddress(ENJIN_RELAY_TREASURY)).toBe("enD9wd...7dX4iA")
  })

  it("honors custom lead and trail lengths", () => {
    expect(shortenAddress(ENJIN_RELAY_TREASURY, 4, 4)).toBe("enD9...X4iA")
  })

  it("returns the input unchanged if it's already short", () => {
    expect(shortenAddress("short")).toBe("short")
  })
})

describe("inspectAddress", () => {
  // One key in every format we care about.
  const CN = "cnTfU9odSe157jiEmsDGsQgBanpTXcDa2GJSJSB2oEdgMnwL9"
  const CX = "cxLbmk2EMgof5CXHhXvNDntWemrce3MuYwRHJLqhc5HYdeqm9"
  const EN = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
  const EF = "efRKnRAsiKi8pHp1LvbvokibcYgcdYMAQFRPgGZKarNzq7dB5"
  // Another key (the treasury account) in Polkadot / generic / hex form.
  const DOT = "13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB"
  const GENERIC = "5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z"
  const HEX = "0x6d6f646c70792f74727372790000000000000000000000000000000000000000"
  const TREASURY_CN = "cnTxmnXAtb5WE48CVU3RKAsdAbgPFhUtQQwjskwLi69N14WBY"

  it("treats blank input as empty", () => {
    expect(inspectAddress("   ", "canary-relay")).toEqual({ status: "empty" })
  })

  it("accepts an address already in the chain's format", () => {
    expect(inspectAddress(CN, "canary-relay")).toEqual({ status: "native", address: CN })
    expect(inspectAddress(` ${EN} `, "enjin-relay")).toEqual({ status: "native", address: EN })
  })

  it("names the network of a foreign-format address and gives the matching one", () => {
    expect(inspectAddress(CX, "canary-relay")).toEqual({
      status: "foreign",
      input: CX,
      networkLabel: "Canary Matrixchain",
      address: CN,
    })
    expect(inspectAddress(EF, "enjin-relay")).toMatchObject({ networkLabel: "Enjin Matrixchain", address: EN })
    expect(inspectAddress(EN, "canary-relay")).toMatchObject({ networkLabel: "Enjin Relaychain", address: CN })
    expect(inspectAddress(DOT, "canary-relay")).toMatchObject({ networkLabel: "Polkadot", address: TREASURY_CN })
    expect(inspectAddress(GENERIC, "canary-relay")).toMatchObject({ networkLabel: "generic Substrate", address: TREASURY_CN })
    expect(inspectAddress(HEX, "canary-relay")).toMatchObject({ networkLabel: "raw public key", address: TREASURY_CN })
  })

  it("rejects broken addresses", () => {
    expect(inspectAddress(CX.slice(0, -1), "canary-relay")).toEqual({ status: "invalid" })
    expect(inspectAddress(`${CX.slice(0, -1)}8`, "canary-relay")).toEqual({ status: "invalid" })
    expect(inspectAddress("0xdeadbeef", "canary-relay")).toEqual({ status: "invalid" })
    expect(inspectAddress("hello", "canary-relay")).toEqual({ status: "invalid" })
  })
})

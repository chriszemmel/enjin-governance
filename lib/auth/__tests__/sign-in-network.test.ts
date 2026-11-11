import { beforeAll, describe, expect, it } from "vitest"
import { cryptoWaitReady, decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import { networkOfAddress, signInFormatError, signInNetworkOf } from "@/lib/auth/sign-in-network"

const KEY = decodeAddress("enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA")
const as = (prefix: number) => encodeAddress(KEY, prefix)

beforeAll(async () => {
  await cryptoWaitReady()
})

describe("networkOfAddress", () => {
  it("reads the network from the exact SS58 prefix", () => {
    expect(networkOfAddress(as(2135))).toBe("enjin-relay")
    expect(networkOfAddress(as(69))).toBe("canary-relay")
    expect(networkOfAddress(as(1110))).toBe("enjin-matrix")
    expect(networkOfAddress(as(9030))).toBe("canary-matrix")
  })

  it("doesn't go by the first letters, which other prefixes share", () => {
    // Prefix 2134 also starts "ef", like Enjin Matrix; 2136 starts "et".
    expect(as(2134).startsWith("ef")).toBe(true)
    expect(networkOfAddress(as(2134))).toBeNull()
    expect(networkOfAddress(as(2136))).toBeNull()
    // Canary Matrix is "cx…", not "cm…".
    expect(as(9030).startsWith("cx")).toBe(true)
  })

  it("has no network for generic, Polkadot or Kusama addresses, raw keys or junk", () => {
    for (const address of [
      as(42),
      as(0),
      as(2),
      `0x${Buffer.from(KEY).toString("hex")}`,
      "not-an-address",
      "",
      // Checksum broken.
      "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iB",
    ]) {
      expect(networkOfAddress(address), address).toBeNull()
    }
  })
})

describe("signInNetworkOf", () => {
  it("takes only the networks the site runs on (the relay chains)", () => {
    expect(signInNetworkOf(as(2135))).toBe("enjin-relay")
    expect(signInNetworkOf(as(69))).toBe("canary-relay")
    expect(signInNetworkOf(as(1110))).toBeNull()
    expect(signInNetworkOf(as(9030))).toBeNull()
    expect(signInNetworkOf(as(42))).toBeNull()
  })

  it("explains which formats sign in", () => {
    expect(signInFormatError()).toBe(
      "Sign in with your Enjin Relaychain (en…) or Canary Relaychain (cn…) address.",
    )
  })
})

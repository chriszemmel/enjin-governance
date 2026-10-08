import { describe, expect, it } from "vitest"
import { TypeRegistry } from "@polkadot/types"
import { u8aToHex } from "@polkadot/util"
import { blake2AsHex } from "@polkadot/util-crypto"
import { runtimeCodeOf } from "@/lib/governance/runtime-code"

const registry = new TypeRegistry()
const WASM = new Uint8Array(300).fill(0xab)
const CODE_HASH = blake2AsHex(WASM, 256)
// Real codecs, so the bare bytes (no SCALE length prefix) are what's hashed.
const code = registry.createType("Bytes", u8aToHex(WASM))
const hash = registry.createType("H256", CODE_HASH)

describe("runtimeCodeOf", () => {
  it("hashes the wasm a setCode call carries", () => {
    for (const method of ["setCode", "setCodeWithoutChecks"]) {
      expect(runtimeCodeOf({ section: "system", method, args: [code] })).toEqual({
        hash: CODE_HASH,
        size: 300,
        via: "setCode",
      })
    }
  })

  it("reads the hash an authorizeUpgrade call carries, with no size", () => {
    for (const method of ["authorizeUpgrade", "authorizeUpgradeWithoutChecks"]) {
      expect(runtimeCodeOf({ section: "system", method, args: [hash] })).toEqual({
        hash: CODE_HASH,
        size: null,
        via: "authorizeUpgrade",
      })
    }
  })

  it("ignores every other call", () => {
    expect(runtimeCodeOf({ section: "system", method: "remark", args: [code] })).toBeNull()
    expect(
      runtimeCodeOf({ section: "system", method: "applyAuthorizedUpgrade", args: [code] }),
    ).toBeNull()
    expect(runtimeCodeOf({ section: "utility", method: "setCode", args: [code] })).toBeNull()
    expect(runtimeCodeOf({ section: "system", method: "setCode", args: [] })).toBeNull()
  })
})

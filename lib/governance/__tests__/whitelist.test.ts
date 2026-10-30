import { describe, expect, it } from "vitest"
import { blake2AsHex } from "@polkadot/util-crypto"
import type { Call } from "@polkadot/types/interfaces"
import { callHash, whitelistRoleOfCall } from "@/lib/governance/whitelist"

const HASH = `0x${"ab".repeat(32)}` as const
const hashArg = { toHex: () => HASH }
const fakeCall = (section: string, method: string, args: unknown[]) =>
  ({ section, method, args }) as unknown as Call

describe("whitelistRoleOfCall", () => {
  it("finds the hash a fellowship referendum whitelists", () => {
    expect(whitelistRoleOfCall(fakeCall("whitelist", "whitelistCall", [hashArg]))).toEqual({
      role: "whitelist",
      hash: HASH,
    })
  })

  it("finds the hash a public referendum dispatches", () => {
    expect(
      whitelistRoleOfCall(fakeCall("whitelist", "dispatchWhitelistedCall", [hashArg, 34, {}])),
    ).toMatchObject({ role: "dispatch", hash: HASH })

    const inner = new Uint8Array([0, 7, 4, 1, 2])
    const withPreimage = whitelistRoleOfCall(
      fakeCall("whitelist", "dispatchWhitelistedCallWithPreimage", [{ toU8a: () => inner }]),
    )
    expect(withPreimage).toMatchObject({ role: "dispatch", hash: blake2AsHex(inner, 256) })
  })

  it("ignores every other call", () => {
    expect(whitelistRoleOfCall(fakeCall("system", "remark", ["0x00"]))).toBeNull()
    expect(whitelistRoleOfCall(fakeCall("whitelist", "removeWhitelistedCall", [hashArg]))).toBeNull()
  })

  it("keys a call by blake2-256 of its encoding", () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(callHash(bytes)).toBe(blake2AsHex(bytes, 256))
  })
})

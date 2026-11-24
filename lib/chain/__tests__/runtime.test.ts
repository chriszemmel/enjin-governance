import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { constEntry, queryEntry, txCall } from "@/lib/chain/runtime"

const api = {
  tx: { referenda: { cancel: (i: number) => ({ cancelled: i }) } },
  query: { treasury: { proposals: async () => "stored" } },
  consts: { treasury: { spendPeriod: { toNumber: () => 14_400 } } },
} as unknown as ApiPromise

describe("txCall", () => {
  it("returns the runtime's call", () => {
    expect(txCall(api, "referenda", "cancel")(7)).toEqual({ cancelled: 7 })
  })

  it("names the missing pallet or call", () => {
    expect(() => txCall(api, "whitelist", "whitelistCall")).toThrow(
      "Chain does not expose whitelist.whitelistCall",
    )
    expect(() => txCall(api, "referenda", "kill")).toThrow("Chain does not expose referenda.kill")
  })
})

describe("queryEntry", () => {
  it("returns the storage entry, or names what is missing", async () => {
    expect(await queryEntry(api, "treasury", "proposals")()).toBe("stored")
    expect(() => queryEntry(api, "treasury", "approvals")).toThrow(
      "Chain does not expose treasury.approvals",
    )
    expect(() => queryEntry(api, "preimage", "preimageFor")).toThrow(
      "Chain does not expose preimage.preimageFor",
    )
  })
})

describe("constEntry", () => {
  it("returns the constant or undefined", () => {
    expect(constEntry(api, "treasury", "spendPeriod")).toBeDefined()
    expect(constEntry(api, "treasury", "burn")).toBeUndefined()
    expect(constEntry(api, "nominationPools", "palletId")).toBeUndefined()
  })
})

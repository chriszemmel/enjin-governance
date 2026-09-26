import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cryptoWaitReady, decodeAddress, encodeAddress } from "@polkadot/util-crypto"

const db = vi.hoisted(() => ({ inserts: [] as unknown[][] }))
vi.mock("@/lib/db/client", () => ({
  getSql:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      db.inserts.push(values)
      return [{ id: "user-1", address: values[0], network: values[1] }]
    },
}))

import { upsertUserByAddress } from "@/lib/db/users"

const KEY = decodeAddress("enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA")
const as = (prefix: number) => encodeAddress(KEY, prefix)

beforeAll(async () => {
  await cryptoWaitReady()
})
beforeEach(() => {
  db.inserts = []
})

describe("upsertUserByAddress", () => {
  it("stores the network read from the address's SS58 prefix", async () => {
    expect((await upsertUserByAddress(as(2135))).network).toBe("enjin-relay")
    expect((await upsertUserByAddress(as(69))).network).toBe("canary-relay")
    expect((await upsertUserByAddress(as(9030))).network).toBe("canary-matrix")
    expect(db.inserts.map((v) => v[1])).toEqual(["enjin-relay", "canary-relay", "canary-matrix"])
  })

  it("never makes a user without a network", async () => {
    // Generic, Polkadot, and a prefix whose addresses also start "ef".
    for (const address of [as(42), as(0), as(2134)]) {
      await expect(upsertUserByAddress(address)).rejects.toThrow(/no known network/i)
    }
    expect(db.inserts).toEqual([])
  })
})

import { describe, expect, it } from "vitest"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import { hasModeratorHint, rememberModeratorRole } from "@/lib/moderation/role-hint"

const MOD = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const OTHER = "efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH"

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  }
}

describe("moderator hint", () => {
  it("knows nothing until a signed-in role is recorded", () => {
    const storage = memoryStorage()
    expect(hasModeratorHint(storage, MOD)).toBe(false)
    rememberModeratorRole(storage, MOD, true)
    expect(hasModeratorHint(storage, MOD)).toBe(true)
    expect(hasModeratorHint(storage, OTHER)).toBe(false)
  })

  it("matches the same wallet under any network prefix", () => {
    const storage = memoryStorage()
    rememberModeratorRole(storage, MOD, true)
    expect(hasModeratorHint(storage, encodeAddress(decodeAddress(MOD), 69))).toBe(true)
  })

  it("forgets a wallet whose role was taken away", () => {
    const storage = memoryStorage()
    rememberModeratorRole(storage, MOD, true)
    rememberModeratorRole(storage, OTHER, true)
    rememberModeratorRole(storage, MOD, false)
    expect(hasModeratorHint(storage, MOD)).toBe(false)
    expect(hasModeratorHint(storage, OTHER)).toBe(true)
  })

  it("ignores junk addresses and junk in storage", () => {
    const storage = memoryStorage({ "enjin-governance:moderator-wallets": "{not json" })
    expect(hasModeratorHint(storage, MOD)).toBe(false)
    rememberModeratorRole(storage, "not an address", true)
    expect(hasModeratorHint(storage, "not an address")).toBe(false)
    rememberModeratorRole(storage, MOD, true)
    expect(hasModeratorHint(storage, MOD)).toBe(true)
  })

  it("keeps working when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    expect(() => rememberModeratorRole(broken, MOD, true)).not.toThrow()
    expect(hasModeratorHint(broken, MOD)).toBe(false)
  })
})

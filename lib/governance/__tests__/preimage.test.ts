import { beforeAll, describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { cryptoWaitReady } from "@polkadot/util-crypto"
import { canInline, getPreimage, hashCall, INLINE_PROPOSAL_MAX_BYTES } from "@/lib/governance/preimage"

beforeAll(async () => {
  await cryptoWaitReady()
})

describe("hashCall", () => {
  it("returns a 0x-prefixed 32-byte hex string", () => {
    const hash = hashCall(new Uint8Array([1, 2, 3, 4]))
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it("is deterministic for the same input", () => {
    const a = hashCall(new Uint8Array([1, 2, 3]))
    const b = hashCall(new Uint8Array([1, 2, 3]))
    expect(a).toBe(b)
  })

  it("differs for different inputs", () => {
    const a = hashCall(new Uint8Array([1, 2, 3]))
    const b = hashCall(new Uint8Array([1, 2, 4]))
    expect(a).not.toBe(b)
  })

  it("hashes the empty input to the canonical empty-blake2-256 digest", () => {
    // Pre-computed blake2-256 of the empty input.
    expect(hashCall(new Uint8Array())).toBe(
      "0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8",
    )
  })
})

describe("canInline", () => {
  it("is true for calls at or under the 128-byte BoundedInline cap", () => {
    expect(canInline(new Uint8Array(0))).toBe(true)
    expect(canInline(new Uint8Array(40))).toBe(true) // ~treasury spend_local
    expect(canInline(new Uint8Array(INLINE_PROPOSAL_MAX_BYTES))).toBe(true)
  })

  it("is false for calls larger than the cap (must use a preimage)", () => {
    expect(canInline(new Uint8Array(INLINE_PROPOSAL_MAX_BYTES + 1))).toBe(false)
    expect(canInline(new Uint8Array(10_000))).toBe(false)
  })

  it("honours a custom threshold", () => {
    expect(canInline(new Uint8Array(50), 40)).toBe(false)
    expect(canInline(new Uint8Array(40), 40)).toBe(true)
  })
})

/* ----- getPreimage: the (hash, len) recovery strategy ladder ----- */

const NONE = {
  isSome: false,
  unwrap: () => {
    throw new Error("unwrap on None")
  },
}

/** An Option<Bytes> whose `.unwrap().toU8a(true)` yields `bytes`. */
function someBytes(bytes: Uint8Array) {
  return { isSome: true, unwrap: () => ({ toU8a: (_bare?: boolean) => bytes }) }
}

/** A `preimageFor` mock that returns bytes only for the matching `len`. */
function preimageForReturning(matchLen: number | null, bytes: Uint8Array, keys: unknown[] = []) {
  return Object.assign(
    async (arg: [string, number]) => (matchLen != null && arg[1] === matchLen ? someBytes(bytes) : NONE),
    { keys: async () => keys },
  )
}

const HEX32 = (b: string) => (`0x${b.repeat(32)}`) as `0x${string}`

describe("getPreimage - len recovery strategies", () => {
  it("strategy 1: reads bytes directly with the supplied len", async () => {
    const BYTES = new Uint8Array([5, 5])
    const api = {
      query: {
        preimage: {
          requestStatusFor: async () => ({
            isSome: true,
            unwrap: () => ({
              isRequested: false,
              isUnrequested: true,
              asUnrequested: { len: { toNumber: () => 2 } },
            }),
          }),
          preimageFor: preimageForReturning(2, BYTES),
        },
      },
    } as unknown as ApiPromise
    const result = await getPreimage(api, { hash: HEX32("ef"), len: 2 })
    expect(result?.bytes).toEqual(BYTES)
    expect(result?.len).toBe(2)
    expect(result?.status).toBe("Unrequested")
  })

  it("strategy 2: recovers len from the Requested request-status row when len is 0", async () => {
    const BYTES = new Uint8Array([9, 8, 7])
    const api = {
      query: {
        preimage: {
          requestStatusFor: async () => ({
            isSome: true,
            unwrap: () => ({
              isRequested: true,
              isUnrequested: false,
              asRequested: { maybeLen: { isSome: true, unwrap: () => ({ toNumber: () => 99 }) } },
            }),
          }),
          // The on-chain entry is keyed by the real len (99), not the 0 we hold.
          preimageFor: preimageForReturning(99, BYTES),
        },
      },
    } as unknown as ApiPromise
    const result = await getPreimage(api, { hash: HEX32("ab"), len: 0 })
    expect(result?.len).toBe(99)
    expect(result?.bytes).toEqual(BYTES)
    expect(result?.status).toBe("Requested")
  })

  it("strategy 3: scans preimageFor keys for the matching hash when status carries no len", async () => {
    const HASH = HEX32("cd")
    const BYTES = new Uint8Array([1, 1, 2, 3])
    const api = {
      query: {
        preimage: {
          requestStatusFor: async () => NONE,
          preimageFor: preimageForReturning(77, BYTES, [
            { args: [{ toJSON: () => ["0xdeadbeef", 5] }] },
            { args: [{ toJSON: () => [HASH, 77] }] },
          ]),
        },
      },
    } as unknown as ApiPromise
    const result = await getPreimage(api, { hash: HASH, len: 0 })
    expect(result?.len).toBe(77)
    expect(result?.bytes).toEqual(BYTES)
    expect(result?.status).toBe("Missing")
  })

  it("returns bytes: null when every strategy misses", async () => {
    const api = {
      query: {
        preimage: {
          requestStatusFor: async () => NONE,
          preimageFor: preimageForReturning(null, new Uint8Array()),
        },
      },
    } as unknown as ApiPromise
    const result = await getPreimage(api, { hash: HEX32("00"), len: 0 })
    expect(result?.bytes).toBeNull()
  })
})

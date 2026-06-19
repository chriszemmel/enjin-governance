import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import type { DispatchError } from "@polkadot/types/interfaces"
import {
  decodeDispatchError,
  didExtrinsicFail,
  findAllEvents,
  findEvent,
  isDiscardedError,
  wasExtrinsicSuccessful,
} from "@/lib/chain/events"

/**
 * Build a minimal EventRecord-shaped object that exercises the pure helpers.
 * The real Polkadot type has many more fields, but findEvent etc. only
 * inspect record.event.section and record.event.method.
 */
function record(section: string, method: string) {
  return { event: { section, method } } as never
}

describe("isDiscardedError", () => {
  it("recognises the State already discarded variant", () => {
    expect(isDiscardedError(new Error("State already discarded for some block"))).toBe(true)
  })

  it("recognises Unknown block / header pruning errors", () => {
    expect(isDiscardedError(new Error("Unknown block 0xabc"))).toBe(true)
    expect(isDiscardedError(new Error("Unable to retrieve header for 0xabc"))).toBe(true)
    expect(
      isDiscardedError(new Error("Unable to retrieve header and parent from supplied hash")),
    ).toBe(true)
  })

  it("returns false for unrelated errors", () => {
    expect(isDiscardedError(new Error("network down"))).toBe(false)
    expect(isDiscardedError(new Error("RPC error: -32603"))).toBe(false)
  })

  it("returns false for non-Error values", () => {
    expect(isDiscardedError("string error")).toBe(false)
    expect(isDiscardedError(null)).toBe(false)
    expect(isDiscardedError(undefined)).toBe(false)
    expect(isDiscardedError({ message: "State already discarded" })).toBe(false)
  })
})

describe("findEvent + findAllEvents", () => {
  const events = [
    record("system", "ExtrinsicSuccess"),
    record("balances", "Transfer"),
    record("balances", "Transfer"),
    record("system", "NewAccount"),
  ]

  it("returns the first match or null", () => {
    expect(findEvent(events, "balances", "Transfer")).not.toBeNull()
    expect(findEvent(events, "treasury", "Spent")).toBeNull()
  })

  it("returns all matches in order", () => {
    expect(findAllEvents(events, "balances", "Transfer")).toHaveLength(2)
    expect(findAllEvents(events, "treasury", "Spent")).toHaveLength(0)
  })
})

describe("wasExtrinsicSuccessful + didExtrinsicFail", () => {
  it("detects ExtrinsicSuccess", () => {
    const successful = [record("system", "ExtrinsicSuccess"), record("balances", "Transfer")]
    expect(wasExtrinsicSuccessful(successful)).toBe(true)
    expect(didExtrinsicFail(successful)).toBe(false)
  })

  it("detects ExtrinsicFailed", () => {
    const failed = [record("system", "ExtrinsicFailed")]
    expect(wasExtrinsicSuccessful(failed)).toBe(false)
    expect(didExtrinsicFail(failed)).toBe(true)
  })
})

describe("decodeDispatchError", () => {
  // The Module path needs a real api.registry; we test the simpler variants
  // here and rely on Phase E integration tests for the Module path.
  const stubApi = {} as ApiPromise

  it("decodes Token errors", () => {
    const err = {
      isModule: false,
      isToken: true,
      isArithmetic: false,
      isTransactional: false,
      asToken: { type: "BelowMinimum" },
    } as unknown as DispatchError
    expect(decodeDispatchError(stubApi, err)).toBe("Token error: BelowMinimum")
  })

  it("decodes Arithmetic errors", () => {
    const err = {
      isModule: false,
      isToken: false,
      isArithmetic: true,
      isTransactional: false,
      asArithmetic: { type: "Overflow" },
    } as unknown as DispatchError
    expect(decodeDispatchError(stubApi, err)).toBe("Arithmetic error: Overflow")
  })

  it("decodes Transactional errors", () => {
    const err = {
      isModule: false,
      isToken: false,
      isArithmetic: false,
      isTransactional: true,
      asTransactional: { type: "LimitReached" },
    } as unknown as DispatchError
    expect(decodeDispatchError(stubApi, err)).toBe("Transactional error: LimitReached")
  })

  it("falls back to toString() for unknown variants", () => {
    const err = {
      isModule: false,
      isToken: false,
      isArithmetic: false,
      isTransactional: false,
      toString: () => "WeirdNewError",
    } as unknown as DispatchError
    expect(decodeDispatchError(stubApi, err)).toBe("Error: WeirdNewError")
  })
})

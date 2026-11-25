import { afterAll, beforeAll, describe, expect, inject, it } from "vitest"
import { treasuryTiersForSpec } from "@/lib/governance/treasury"
import { defined } from "@/test/defined"
import { connectFork, dispatchAsOrigin, ENJ, type Fork } from "./chain"

/**
 * The treasury's spend limits per origin (`ENJIN_SPEND_LIMITS`) are copied from
 * the runtime, which doesn't expose them. This runs the real thing on a fork of
 * Enjin Relay mainnet: each origin's limit passes and one ENJ above it fails
 * with `InsufficientPermission`, for `spend_local` and for `spend`. It fails
 * when an upgrade changes a limit, or the table has no entry for the spec the
 * chain runs, which is the cue to update `lib/governance/treasury.ts`.
 */

let fork: Fork
let beneficiary: string

beforeAll(async () => {
  fork = await connectFork(inject("forkWs"))
  beneficiary = fork.dave.address
})

afterAll(async () => {
  await fork.api.disconnect()
})

describe("treasury spend limits", () => {
  it("the app lists the spec the chain runs", () => {
    const spec = fork.api.runtimeVersion.specVersion.toNumber()
    expect(treasuryTiersForSpec(spec)?.verified, `no spend limits for spec ${spec}`).toBe(true)
  })

  it("each origin's limit passes, and one ENJ above it fails, for spend_local and spend", async () => {
    const spec = fork.api.runtimeVersion.specVersion.toNumber()
    const tiers = defined(treasuryTiersForSpec(spec), "the tier table").tiers
    const local = (amount: bigint) =>
      defined(fork.api.tx.treasury?.spendLocal?.(amount, beneficiary), "treasury.spendLocal")
    const asset = (amount: bigint) =>
      defined(fork.api.tx.treasury?.spend?.(null, amount, beneficiary, null), "treasury.spend")

    for (const { origin, maxAmount: limit } of tiers) {
      const maxAmount = defined(limit, `${origin}'s limit`)
      const as = { origins: origin }
      for (const [name, build] of [
        ["spend_local", local],
        ["spend", asset],
      ] as const) {
        const atLimit = await dispatchAsOrigin(fork, build(maxAmount), as)
        expect(atLimit.ok, `${name} at ${origin}'s limit`).toBe(true)
        const above = await dispatchAsOrigin(fork, build(maxAmount + ENJ), as)
        expect(above.ok, `${name} one ENJ above ${origin}'s limit`).toBe(false)
      }
    }
  })
})

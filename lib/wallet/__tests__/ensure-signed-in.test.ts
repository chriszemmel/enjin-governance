import { describe, expect, it, vi } from "vitest"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"

vi.mock("@/lib/wallet/connector-registry", () => ({ getConnectorMeta: () => ({}) }))

import { dismissable, isSessionFor } from "@/lib/wallet/use-ensure-signed-in"

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
const ALICE_ENJIN = encodeAddress(decodeAddress(ALICE), 2135)

/**
 * A sign-in session counts for a wallet only when it is that wallet's key:
 * the write routes refuse every other account. The drafts panel and
 * ensureSignedIn share this test, so a session for another account shows
 * the sign-in prompt instead of an empty drafts list.
 */
describe("isSessionFor", () => {
  it("matches the wallet's own session in any address format", () => {
    expect(isSessionFor({ address: ALICE_ENJIN }, ALICE)).toBe(true)
    expect(isSessionFor({ address: ALICE }, ALICE_ENJIN)).toBe(true)
  })

  it("never counts a session for another account, or none", () => {
    expect(isSessionFor({ address: BOB }, ALICE)).toBe(false)
    expect(isSessionFor(null, ALICE)).toBe(false)
    expect(isSessionFor(undefined, ALICE)).toBe(false)
    expect(isSessionFor({ address: ALICE }, null)).toBe(false)
    expect(isSessionFor({ address: "not-an-address" }, ALICE)).toBe(false)
  })
})

/**
 * Closing the WalletConnect sign-in dialog must settle the sign-in at once:
 * the wallet keeps the request open for 15 minutes, and the composers hold
 * their click guard until ensureSignedIn returns.
 */
describe("dismissable", () => {
  const pending = <T>() => {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it("settles with 'dismissed' while the work is still waiting", async () => {
    const work = pending<string>()
    const attempt = dismissable(work.promise)
    attempt.dismiss()
    await expect(attempt.result).resolves.toBe("dismissed")
    // A late failure (the request expiring) is ignored, not unhandled.
    work.reject(new Error("request expired"))
    await Promise.resolve()
  })

  it("passes the work's own answer or error through when it comes first", async () => {
    const ok = pending<string>()
    const signed = dismissable(ok.promise)
    ok.resolve("signed")
    await expect(signed.result).resolves.toBe("signed")
    signed.dismiss()

    const bad = pending<string>()
    const rejected = dismissable(bad.promise)
    bad.reject(new Error("User rejected"))
    await expect(rejected.result).rejects.toThrow("User rejected")
  })
})

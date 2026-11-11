import { describe, expect, it } from "vitest"
import {
  clearRequestDelivered,
  isRequestDelivered,
  markRequestDelivered,
  subscribeRequestDelivery,
} from "@/lib/wallet/request-delivery"

describe("request delivery", () => {
  it("tells subscribers once per change and clears per topic", () => {
    let calls = 0
    const stop = subscribeRequestDelivery(() => calls++)
    expect(isRequestDelivered()).toBe(false)

    markRequestDelivered("t1")
    markRequestDelivered("t1")
    expect(isRequestDelivered()).toBe(true)
    expect(calls).toBe(1)

    clearRequestDelivered("other")
    expect(calls).toBe(1)
    clearRequestDelivered("t1")
    expect(isRequestDelivered()).toBe(false)
    expect(calls).toBe(2)

    stop()
    markRequestDelivered("t2")
    expect(calls).toBe(2)
    clearRequestDelivered("t2")
  })
})

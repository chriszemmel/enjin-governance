import { beforeAll, describe, expect, it } from "vitest"
import { initializeWasm } from "@/lib/chain/ss58"
import { CHAINS } from "@/lib/chain/chains"
import {
  intentFromPreimage,
  intentFromSubscanCall,
} from "@/lib/governance/call-extract"

const RELAY = CHAINS["enjin-relay"]

beforeAll(async () => {
  // SS58 address validation needs the WASM crypto backend.
  await initializeWasm()
})

describe("intentFromSubscanCall", () => {
  it("extracts treasury.spend_local amount + beneficiary", () => {
    const intent = intentFromSubscanCall(
      {
        call_module: "Treasury",
        call_name: "spend_local",
        params: [
          { name: "amount", value: "150000000000000000000000" },
          {
            name: "beneficiary",
            value: { Id: "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA" },
          },
        ],
      },
      RELAY,
    )
    expect(intent?.kind).toBe("treasury-spend")
    if (intent?.kind !== "treasury-spend") return
    expect(intent.amount).toBe(150_000n * 10n ** 18n)
    expect(intent.beneficiary).toBe(
      "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA",
    )
    expect(intent.method).toMatch(/spend(_local)?/)
  })

  it("falls back to generic for non-treasury calls", () => {
    const intent = intentFromSubscanCall(
      { call_module: "Balances", call_name: "transfer", params: [] },
      RELAY,
    )
    expect(intent).toEqual({
      kind: "generic",
      section: "balances",
      method: "transfer",
    })
  })

  it("handles raw-string beneficiary", () => {
    const intent = intentFromSubscanCall(
      {
        call_module: "treasury",
        call_name: "spendLocal",
        params: [
          { name: "value", value: "1000000000000000000000" },
          {
            name: "beneficiary",
            value: "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA",
          },
        ],
      },
      RELAY,
    )
    expect(intent?.kind).toBe("treasury-spend")
    if (intent?.kind !== "treasury-spend") return
    expect(intent.amount).toBe(1000n * 10n ** 18n)
  })

  it("returns null on null input", () => {
    expect(intentFromSubscanCall(null, RELAY)).toBeNull()
    expect(intentFromSubscanCall(undefined, RELAY)).toBeNull()
  })

  it("re-encodes a hex public-key beneficiary to the chain SS58", () => {
    const intent = intentFromSubscanCall(
      {
        call_module: "Treasury",
        call_name: "spend_local",
        params: [
          { name: "amount", value: "150000000000000000000000" },
          {
            name: "beneficiary",
            value: {
              Id: "0xeabc3de73eed4b109296d35c47f2f5d392fa0e582ebb85822baf1e2b15cc435f",
            },
          },
        ],
      },
      RELAY,
    )
    expect(intent?.kind).toBe("treasury-spend")
    if (intent?.kind !== "treasury-spend") return
    // Enjin Relay SS58 prefix 2135 → addresses start with "en".
    expect(intent.beneficiary.startsWith("en")).toBe(true)
    expect(intent.beneficiary).not.toMatch(/^0x/)
  })
})

describe("intentFromPreimage", () => {
  it("parses comma-formatted human amounts", () => {
    const intent = intentFromPreimage(
      {
        section: "treasury",
        method: "spendLocal",
        args: {
          amount: "150,000,000,000,000,000,000,000",
          beneficiary: { Id: "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA" },
        },
      },
      RELAY,
    )
    expect(intent?.kind).toBe("treasury-spend")
    if (intent?.kind !== "treasury-spend") return
    expect(intent.amount).toBe(150_000n * 10n ** 18n)
  })

  it("returns generic when args don't shape into a treasury-spend", () => {
    const intent = intentFromPreimage(
      {
        section: "treasury",
        method: "spendLocal",
        args: { unrelated: "value" },
      },
      RELAY,
    )
    expect(intent?.kind).toBe("generic")
  })

  it("returns null for empty preimage", () => {
    expect(
      intentFromPreimage({ section: "", method: "", args: {} }, RELAY),
    ).toBeNull()
  })
})

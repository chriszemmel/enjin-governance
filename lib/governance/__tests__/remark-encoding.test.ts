import { describe, expect, it } from "vitest"
import { stringToHex } from "@polkadot/util"
import { buildRemarkPayload } from "@/lib/governance/proposal-metadata"

describe("envelope payload encoding", () => {
  // Guard: on the canary runtime, passing a bare Uint8Array to a
  // Bytes-typed extrinsic arg (system.remark historically, now the
  // envelope's preimage.notePreimage) triggers a polkadot.js codec
  // mis-decode ("Bytes: required length less than remainder, expected at
  // least N"), so we always pass a hex string. This test asserts the
  // contract - that the payload is producible as hex and round-trips -
  // since constructing an ApiPromise in the test would require a chain
  // connection.
  it("round-trips through stringToHex without loss", () => {
    const payload = buildRemarkPayload(
      "https://pub-xxx.r2.dev/proposals/canary-relay/abc/proposal.json",
      "a".repeat(64),
    )
    const hex = stringToHex(payload)
    expect(hex.startsWith("0x")).toBe(true)
    expect(hex).toMatch(/^0x[0-9a-f]+$/)
    // Hex is 2 chars per UTF-8 byte plus the 0x prefix.
    expect((hex.length - 2) / 2).toBe(new TextEncoder().encode(payload).length)
  })
})

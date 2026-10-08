import { describe, expect, it } from "vitest"
import type { SignerPayloadJSON } from "@polkadot/types/types"
import { describeRelayRefusal, toRequestPayload } from "@/lib/wallet/connectors/walletconnect"

/**
 * Enjin Wallet rejects a `polkadot_signTransaction` request with
 * "Transaction invalid" when the payload carries @polkadot/api's extra
 * fields. The polkadot-js extension ignores them, so the bug only shows on
 * the WalletConnect path. These tests pin exactly which keys are stripped
 * and - more importantly - which are not, since dropping a signed-extra
 * field would invalidate the signature rather than fix it.
 */

const PAYLOAD = {
  address: "cnUUyvypCfi3XCrTTgYp4m6Ka9V1DyXCW3cvZp9pALU19oK4Y",
  assetId: null,
  blockHash: "0x735d8773c63e74ff8490fee5751ac07e15bfe2b3b5263be4d683c48dbdfbcd15",
  blockNumber: "0x00000000",
  era: "0x00",
  genesisHash: "0x735d8773c63e74ff8490fee5751ac07e15bfe2b3b5263be4d683c48dbdfbcd15",
  metadataHash: null,
  method: "0x00000400",
  mode: 0,
  nonce: "0x00000000",
  signedExtensions: ["CheckMortality", "CheckMetadataHash", "CheckFuelTank"],
  tip: "0x00000000000000000000000000000000",
  version: 4,
  withSignedTransaction: false,
} as unknown as SignerPayloadJSON

describe("toRequestPayload", () => {
  it("drops the keys Enjin Wallet chokes on", () => {
    const out = toRequestPayload(PAYLOAD)
    expect(out).not.toHaveProperty("assetId")
    expect(out).not.toHaveProperty("metadataHash")
    expect(out).not.toHaveProperty("withSignedTransaction")
  })

  it("keeps every field that feeds the signed bytes", () => {
    const out = toRequestPayload(PAYLOAD)
    // mode is the CheckMetadataHash signed extra - stripping it would make
    // the wallet sign different bytes than the extrinsic we broadcast.
    expect(out.mode).toBe(0)
    expect(out.era).toBe("0x00")
    expect(out.nonce).toBe("0x00000000")
    expect(out.tip).toBe("0x00000000000000000000000000000000")
    expect(out.method).toBe("0x00000400")
    expect(out.genesisHash).toBe(PAYLOAD.genesisHash)
    expect(out.blockHash).toBe(PAYLOAD.blockHash)
    expect(out.blockNumber).toBe("0x00000000")
    expect(out.specVersion).toBe(PAYLOAD.specVersion)
    expect(out.transactionVersion).toBe(PAYLOAD.transactionVersion)
    expect(out.version).toBe(4)
    expect(out.address).toBe(PAYLOAD.address)
    expect(out.signedExtensions).toEqual([
      "CheckMortality",
      "CheckMetadataHash",
      "CheckFuelTank",
    ])
  })

  it("keeps a metadataHash when one is actually set (mode 1)", () => {
    const withHash = {
      ...PAYLOAD,
      mode: 1,
      metadataHash: "0xabc123",
    } as unknown as SignerPayloadJSON
    const out = toRequestPayload(withHash)
    expect(out.mode).toBe(1)
    expect(out.metadataHash).toBe("0xabc123")
  })

  it("leaves a zero tip and mode 0 intact rather than treating them as empty", () => {
    const out = toRequestPayload(PAYLOAD)
    expect(Object.keys(out)).toContain("mode")
    expect(Object.keys(out)).toContain("tip")
  })
})

describe("describeRelayRefusal", () => {
  const ORIGIN = "https://preview.example.vercel.app"
  const ID = "0123456789abcdef0123456789abcdef"

  it("names the origin and the project when the relay refuses the site", () => {
    const msg = describeRelayRefusal(
      "WebSocket connection closed abnormally with code: 3000 (Unauthorized: origin not allowed)",
      ORIGIN,
      ID,
    )
    expect(msg).toContain(ORIGIN)
    expect(msg).toContain("…abcdef")
    expect(msg).toContain("allowed domains")
  })

  it("points at the env var when the relay rejects the project id", () => {
    const msg = describeRelayRefusal(
      "WebSocket connection closed abnormally with code: 3000 (Unauthorized: invalid key)",
      ORIGIN,
      ID,
    )
    expect(msg).toContain("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID")
    expect(msg).toContain("…abcdef")
  })

  it("passes any other reason through", () => {
    expect(describeRelayRefusal("socket hang up", ORIGIN, ID)).toBe(
      "WalletConnect closed the connection: socket hang up",
    )
  })
})

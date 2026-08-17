import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { blake2AsHex } from "@polkadot/util-crypto"
import { stringToHex, u8aToHex } from "@polkadot/util"
import {
  buildTreasuryProposal,
  previewPreimage,
} from "@/lib/governance/submit-treasury-proposal"
import { ENJIN_TREASURY_TIERS } from "@/lib/governance/treasury"

/**
 * buildTreasuryProposal composes [notePreimage, submit, remark]. We fake
 * `api.tx` so each builder records the args it receives and returns a tagged
 * object, letting us assert call ordering, the Lookup wrapping, and - most
 * importantly - that the remark is passed as a hex string (the documented
 * codec workaround), not the raw UTF-8 payload.
 */

const CALL_BYTES = new Uint8Array([1, 2, 3, 4])
const CALL_HEX = u8aToHex(CALL_BYTES) // "0x01020304"
const EXPECTED_HASH = blake2AsHex(CALL_BYTES, 256)

type Recorded = { call: string; args: unknown[] }

function fakeApi(sink: Recorded[]): ApiPromise {
  const rec =
    (name: string, ret: unknown) =>
    (...args: unknown[]) => {
      sink.push({ call: name, args })
      return ret
    }
  return {
    tx: {
      treasury: {
        spendLocal: rec("treasury.spendLocal", { method: { toU8a: () => CALL_BYTES } }),
      },
      preimage: { notePreimage: rec("preimage.notePreimage", { __tx: "note" }) },
      referenda: { submit: rec("referenda.submit", { __tx: "submit" }) },
      system: { remark: rec("system.remark", { __tx: "remark" }) },
    },
  } as unknown as ApiPromise
}

const tier = ENJIN_TREASURY_TIERS[0]

describe("buildTreasuryProposal", () => {
  it("derives hash/len/callHex from the spend_local call bytes", () => {
    const built = buildTreasuryProposal(fakeApi([]), {
      amount: 1000n,
      beneficiary: "enAlice",
      tier,
      remarkPayload: 'EGOV1:{"u":"https://x/p.json","h":"deadbeef"}',
    })
    expect(built.preimageHash).toBe(EXPECTED_HASH)
    expect(built.preimageLen).toBe(4)
    expect(built.callHex).toBe(CALL_HEX)
  })

  it("orders the batch as [notePreimage, submit, remark]", () => {
    const sink: Recorded[] = []
    const built = buildTreasuryProposal(fakeApi(sink), {
      amount: 1000n,
      beneficiary: "enAlice",
      tier,
      remarkPayload: "EGOV1:{}",
    })
    expect(built.calls).toEqual([built.noteTx, built.submitTx, built.remarkTx])
    expect(built.calls).toEqual([{ __tx: "note" }, { __tx: "submit" }, { __tx: "remark" }])
    // spendLocal runs first (to produce the bytes), then the three batch members.
    expect(sink.map((r) => r.call)).toEqual([
      "treasury.spendLocal",
      "preimage.notePreimage",
      "referenda.submit",
      "system.remark",
    ])
  })

  it("passes the spend amount as a string and the beneficiary verbatim", () => {
    const sink: Recorded[] = []
    buildTreasuryProposal(fakeApi(sink), {
      amount: 250n,
      beneficiary: "enBob",
      tier,
      remarkPayload: "EGOV1:{}",
    })
    const spend = sink.find((r) => r.call === "treasury.spendLocal")!
    expect(spend.args).toEqual(["250", "enBob"])
  })

  it("notes the preimage as the hex of the call bytes", () => {
    const sink: Recorded[] = []
    buildTreasuryProposal(fakeApi(sink), {
      amount: 1n,
      beneficiary: "enBob",
      tier,
      remarkPayload: "EGOV1:{}",
    })
    const note = sink.find((r) => r.call === "preimage.notePreimage")!
    expect(note.args).toEqual([CALL_HEX])
  })

  it("submits with the tier origin, Lookup wrapper, and After-0 enactment", () => {
    const sink: Recorded[] = []
    buildTreasuryProposal(fakeApi(sink), {
      amount: 1n,
      beneficiary: "enBob",
      tier,
      remarkPayload: "EGOV1:{}",
    })
    const submit = sink.find((r) => r.call === "referenda.submit")!
    expect(submit.args).toEqual([
      { Origins: tier.origin },
      { Lookup: { hash: EXPECTED_HASH, len: 4 } },
      { After: 0 },
    ])
  })

  it("throws if the chosen tier cannot authorize the amount (submit-time guard)", () => {
    const undersized = { origin: "SmallTipper", maxAmount: 100n } as const
    expect(() =>
      buildTreasuryProposal(fakeApi([]), {
        amount: 101n,
        beneficiary: "enAlice",
        tier: undersized,
        remarkPayload: "EGOV1:{}",
      }),
    ).toThrow(/SmallTipper/)
  })

  it("passes the remark as a HEX string, never the raw UTF-8 payload", () => {
    const sink: Recorded[] = []
    const payload = 'EGOV1:{"u":"https://x/p.json","h":"abc123"}'
    buildTreasuryProposal(fakeApi(sink), {
      amount: 1n,
      beneficiary: "enBob",
      tier,
      remarkPayload: payload,
    })
    const remark = sink.find((r) => r.call === "system.remark")!
    expect(remark.args).toEqual([stringToHex(payload)])
    expect(remark.args[0]).not.toBe(payload)
  })
})

describe("previewPreimage", () => {
  it("computes the same hash/len/callHex without building submit/remark", () => {
    const sink: Recorded[] = []
    const preview = previewPreimage(fakeApi(sink), { amount: 1000n, beneficiary: "enAlice" })
    expect(preview.preimageHash).toBe(EXPECTED_HASH)
    expect(preview.preimageLen).toBe(4)
    expect(preview.callHex).toBe(CALL_HEX)
    // Only the spend call + preimage note are touched - no submit, no remark.
    expect(sink.map((r) => r.call)).toEqual(["treasury.spendLocal", "preimage.notePreimage"])
  })
})

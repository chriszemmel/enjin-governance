import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { blake2AsHex } from "@polkadot/util-crypto"
import { stringToU8a, u8aToHex } from "@polkadot/util"
import {
  buildTreasuryProposal,
  previewPreimage,
} from "@/lib/governance/submit-treasury-proposal"
import { ENJIN_TREASURY_TIERS } from "@/lib/governance/treasury"

/**
 * buildTreasuryProposal composes [notePreimage, submit, notePreimage,
 * setMetadata]. We fake `api.tx` so each builder records the args it
 * receives and returns a tagged object, letting us assert call ordering,
 * the Lookup wrapping, the envelope's hex encoding, and - most importantly
 * - that setMetadata binds the blake2-256 of the envelope bytes to the
 * referendum index read at build time.
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
      referenda: {
        submit: rec("referenda.submit", { __tx: "submit" }),
        setMetadata: rec("referenda.setMetadata", { __tx: "setMetadata" }),
      },
    },
  } as unknown as ApiPromise
}

const tier = ENJIN_TREASURY_TIERS[0]

const ENVELOPE = 'EGOV1:{"u":"https://x/p.json","h":"deadbeef"}'
const ENVELOPE_BYTES = stringToU8a(ENVELOPE)
const ENVELOPE_HASH = blake2AsHex(ENVELOPE_BYTES, 256)

describe("buildTreasuryProposal", () => {
  it("derives hash/len/callHex from the spend_local call bytes", () => {
    const built = buildTreasuryProposal(fakeApi([]), {
      amount: 1000n,
      beneficiary: "enAlice",
      tier,
      remarkPayload: ENVELOPE,
      referendumIndex: 11,
    })
    expect(built.preimageHash).toBe(EXPECTED_HASH)
    expect(built.preimageLen).toBe(4)
    expect(built.callHex).toBe(CALL_HEX)
  })

  it("derives metadataHash/metadataLen from the envelope bytes", () => {
    const built = buildTreasuryProposal(fakeApi([]), {
      amount: 1000n,
      beneficiary: "enAlice",
      tier,
      remarkPayload: ENVELOPE,
      referendumIndex: 11,
    })
    expect(built.metadataHash).toBe(ENVELOPE_HASH)
    expect(built.metadataLen).toBe(ENVELOPE_BYTES.length)
  })

  it("orders the batch as [notePreimage, submit, notePreimage, setMetadata]", () => {
    const sink: Recorded[] = []
    const built = buildTreasuryProposal(fakeApi(sink), {
      amount: 1000n,
      beneficiary: "enAlice",
      tier,
      remarkPayload: "EGOV1:{}",
      referendumIndex: 0,
    })
    expect(built.calls).toEqual([
      built.noteTx,
      built.submitTx,
      built.metadataNoteTx,
      built.setMetadataTx,
    ])
    expect(built.calls).toEqual([
      { __tx: "note" },
      { __tx: "submit" },
      { __tx: "note" },
      { __tx: "setMetadata" },
    ])
    // spendLocal runs first (to produce the bytes), then the four batch
    // members. setMetadata is strictly after both submit (the referendum
    // must exist) and the envelope note (the hash must resolve) - the
    // runtime rejects any other order with PreimageNotExist.
    expect(sink.map((r) => r.call)).toEqual([
      "treasury.spendLocal",
      "preimage.notePreimage",
      "referenda.submit",
      "preimage.notePreimage",
      "referenda.setMetadata",
    ])
  })

  it("passes the spend amount as a string and the beneficiary verbatim", () => {
    const sink: Recorded[] = []
    buildTreasuryProposal(fakeApi(sink), {
      amount: 250n,
      beneficiary: "enBob",
      tier,
      remarkPayload: "EGOV1:{}",
      referendumIndex: 0,
    })
    const spend = sink.find((r) => r.call === "treasury.spendLocal")!
    expect(spend.args).toEqual(["250", "enBob"])
  })

  it("notes the spend preimage as the hex of the call bytes", () => {
    const sink: Recorded[] = []
    buildTreasuryProposal(fakeApi(sink), {
      amount: 1n,
      beneficiary: "enBob",
      tier,
      remarkPayload: "EGOV1:{}",
      referendumIndex: 0,
    })
    const note = sink.find((r) => r.call === "preimage.notePreimage")!
    expect(note.args).toEqual([CALL_HEX])
  })

  it("notes the envelope preimage as the hex of its UTF-8 bytes", () => {
    const sink: Recorded[] = []
    buildTreasuryProposal(fakeApi(sink), {
      amount: 1n,
      beneficiary: "enBob",
      tier,
      remarkPayload: ENVELOPE,
      referendumIndex: 0,
    })
    const notes = sink.filter((r) => r.call === "preimage.notePreimage")
    expect(notes).toHaveLength(2)
    expect(notes[1].args).toEqual([u8aToHex(ENVELOPE_BYTES)])
  })

  it("submits with the tier origin, Lookup wrapper, and After-0 enactment", () => {
    const sink: Recorded[] = []
    buildTreasuryProposal(fakeApi(sink), {
      amount: 1n,
      beneficiary: "enBob",
      tier,
      remarkPayload: "EGOV1:{}",
      referendumIndex: 0,
    })
    const submit = sink.find((r) => r.call === "referenda.submit")!
    expect(submit.args).toEqual([
      { Origins: tier.origin },
      { Lookup: { hash: EXPECTED_HASH, len: 4 } },
      { After: 0 },
    ])
  })

  it("binds setMetadata to the given index and the envelope's blake2-256", () => {
    const sink: Recorded[] = []
    buildTreasuryProposal(fakeApi(sink), {
      amount: 1n,
      beneficiary: "enBob",
      tier,
      remarkPayload: ENVELOPE,
      referendumIndex: 11,
    })
    const set = sink.find((r) => r.call === "referenda.setMetadata")!
    expect(set.args).toEqual([11, ENVELOPE_HASH])
  })

  it("passes the referendum index through verbatim - a different count targets a different index", () => {
    for (const index of [0, 7, 42]) {
      const sink: Recorded[] = []
      buildTreasuryProposal(fakeApi(sink), {
        amount: 1n,
        beneficiary: "enBob",
        tier,
        remarkPayload: ENVELOPE,
        referendumIndex: index,
      })
      const set = sink.find((r) => r.call === "referenda.setMetadata")!
      expect(set.args[0]).toBe(index)
    }
  })

  it("hashes the envelope bytes for setMetadata, never the sha256 inside the envelope", () => {
    const sink: Recorded[] = []
    const built = buildTreasuryProposal(fakeApi(sink), {
      amount: 1n,
      beneficiary: "enBob",
      tier,
      remarkPayload: ENVELOPE,
      referendumIndex: 3,
    })
    const set = sink.find((r) => r.call === "referenda.setMetadata")!
    expect(set.args[1]).toBe(ENVELOPE_HASH)
    expect(set.args[1]).not.toContain("deadbeef")
    // Nor the spend call's preimage hash - the two preimages are distinct.
    expect(built.metadataHash).not.toBe(built.preimageHash)
  })

  it("throws if the chosen tier cannot authorize the amount (submit-time guard)", () => {
    const undersized = { origin: "SmallTipper", maxAmount: 100n } as const
    expect(() =>
      buildTreasuryProposal(fakeApi([]), {
        amount: 101n,
        beneficiary: "enAlice",
        tier: undersized,
        remarkPayload: "EGOV1:{}",
        referendumIndex: 0,
      }),
    ).toThrow(/SmallTipper/)
  })
})

describe("previewPreimage", () => {
  it("computes the same hash/len/callHex without building submit/setMetadata", () => {
    const sink: Recorded[] = []
    const preview = previewPreimage(fakeApi(sink), { amount: 1000n, beneficiary: "enAlice" })
    expect(preview.preimageHash).toBe(EXPECTED_HASH)
    expect(preview.preimageLen).toBe(4)
    expect(preview.callHex).toBe(CALL_HEX)
    // Only the spend call + preimage note are touched - no submit, no metadata.
    expect(sink.map((r) => r.call)).toEqual(["treasury.spendLocal", "preimage.notePreimage"])
  })
})

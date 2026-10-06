import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { blake2AsHex } from "@polkadot/util-crypto"
import { stringToU8a, u8aToHex } from "@polkadot/util"
import { INLINE_PROPOSAL_MAX_BYTES } from "@/lib/governance/preimage"
import { buildProposalSubmission } from "@/lib/governance/submit-proposal"

/**
 * buildProposalSubmission composes [notePreimage?, submit] plus, with
 * metadata, [notePreimage(envelope), setMetadata]. We fake `api.tx` so each
 * builder records its args and returns a tagged object, letting us assert
 * inline-vs-Lookup routing, ordering, and that setMetadata binds the
 * envelope's blake2-256 to the given index.
 */

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
      preimage: { notePreimage: rec("preimage.notePreimage", { __tx: "note" }) },
      referenda: {
        submit: rec("referenda.submit", { __tx: "submit" }),
        setMetadata: rec("referenda.setMetadata", { __tx: "setMetadata" }),
      },
    },
  } as unknown as ApiPromise
}

const ROOT = { System: "Root" }
const AFTER_0 = { type: "After", block: 0 } as const

// system.authorizeUpgrade(code_hash): 2-byte call index + 32-byte hash.
const SMALL_CALL = new Uint8Array(34).fill(7)
const SMALL_HASH = blake2AsHex(SMALL_CALL, 256)
// One byte past the inline bound - must be noted and referenced by Lookup.
const BIG_CALL = new Uint8Array(INLINE_PROPOSAL_MAX_BYTES + 1).fill(9)
const BIG_HASH = blake2AsHex(BIG_CALL, 256)

const ENVELOPE = 'EGOV1:{"u":"https://x/p.json","h":"deadbeef"}'
const ENVELOPE_BYTES = stringToU8a(ENVELOPE)
const ENVELOPE_HASH = blake2AsHex(ENVELOPE_BYTES, 256)

describe("buildProposalSubmission", () => {
  it("submits a small call inline, with no preimage note", () => {
    const sink: Recorded[] = []
    const built = buildProposalSubmission(fakeApi(sink), {
      callBytes: SMALL_CALL,
      origin: ROOT,
      enactment: AFTER_0,
    })
    expect(built.inline).toBe(true)
    expect(built.callHash).toBe(SMALL_HASH)
    expect(built.callLen).toBe(34)
    expect(built.metadataHash).toBeNull()
    expect(built.calls).toEqual([{ __tx: "submit" }])
    expect(sink).toEqual([
      {
        call: "referenda.submit",
        args: [ROOT, { Inline: u8aToHex(SMALL_CALL) }, { After: 0 }],
      },
    ])
  })

  it("notes a large call and submits it by Lookup", () => {
    const sink: Recorded[] = []
    const built = buildProposalSubmission(fakeApi(sink), {
      callBytes: BIG_CALL,
      origin: ROOT,
      enactment: AFTER_0,
    })
    expect(built.inline).toBe(false)
    expect(built.callHash).toBe(BIG_HASH)
    expect(built.calls).toEqual([{ __tx: "note" }, { __tx: "submit" }])
    expect(sink[0]).toEqual({ call: "preimage.notePreimage", args: [u8aToHex(BIG_CALL)] })
    expect(sink[1]!.args[1]).toEqual({
      Lookup: { hash: BIG_HASH, len: INLINE_PROPOSAL_MAX_BYTES + 1 },
    })
  })

  it("drops the call's notePreimage when skipNote is set, keeping the same Lookup", () => {
    const built = buildProposalSubmission(fakeApi([]), {
      callBytes: BIG_CALL,
      origin: ROOT,
      enactment: AFTER_0,
      skipNote: true,
    })
    expect(built.calls).toEqual([{ __tx: "submit" }])
    expect(built.callHash).toBe(BIG_HASH)
  })

  it("orders an inline submission with metadata as [submit, notePreimage, setMetadata]", () => {
    const sink: Recorded[] = []
    const built = buildProposalSubmission(fakeApi(sink), {
      callBytes: SMALL_CALL,
      origin: ROOT,
      enactment: AFTER_0,
      metadata: { remarkPayload: ENVELOPE, referendumIndex: 11 },
    })
    expect(built.calls).toEqual([{ __tx: "submit" }, { __tx: "note" }, { __tx: "setMetadata" }])
    expect(sink.map((r) => r.call)).toEqual([
      "referenda.submit",
      "preimage.notePreimage",
      "referenda.setMetadata",
    ])
  })

  it("orders a Lookup submission with metadata as [note, submit, note, setMetadata]", () => {
    const built = buildProposalSubmission(fakeApi([]), {
      callBytes: BIG_CALL,
      origin: ROOT,
      enactment: AFTER_0,
      metadata: { remarkPayload: ENVELOPE, referendumIndex: 3 },
    })
    expect(built.calls).toEqual([
      { __tx: "note" },
      { __tx: "submit" },
      { __tx: "note" },
      { __tx: "setMetadata" },
    ])
  })

  it("keeps the envelope note when skipNote drops the call's", () => {
    const sink: Recorded[] = []
    buildProposalSubmission(fakeApi(sink), {
      callBytes: BIG_CALL,
      origin: ROOT,
      enactment: AFTER_0,
      skipNote: true,
      metadata: { remarkPayload: ENVELOPE, referendumIndex: 3 },
    })
    const notes = sink.filter((r) => r.call === "preimage.notePreimage")
    // noteAndHash builds the call's note even when it's skipped; only the
    // envelope's note may reach the batch.
    expect(notes.at(-1)!.args).toEqual([u8aToHex(ENVELOPE_BYTES)])
  })

  it("binds setMetadata to the given index and the envelope's blake2-256", () => {
    const sink: Recorded[] = []
    const built = buildProposalSubmission(fakeApi(sink), {
      callBytes: SMALL_CALL,
      origin: ROOT,
      enactment: AFTER_0,
      metadata: { remarkPayload: ENVELOPE, referendumIndex: 42 },
    })
    const set = sink.find((r) => r.call === "referenda.setMetadata")!
    expect(set.args).toEqual([42, ENVELOPE_HASH])
    expect(built.metadataHash).toBe(ENVELOPE_HASH)
    // Never the sha256 inside the envelope, nor the call's own hash.
    expect(set.args[1]).not.toContain("deadbeef")
    expect(built.metadataHash).not.toBe(built.callHash)
  })

  it("passes origin and an At enactment through verbatim", () => {
    const sink: Recorded[] = []
    buildProposalSubmission(fakeApi(sink), {
      callBytes: SMALL_CALL,
      origin: { Origins: "WhitelistedCaller" },
      enactment: { type: "At", block: 1234 },
    })
    expect(sink[0]!.args[0]).toEqual({ Origins: "WhitelistedCaller" })
    expect(sink[0]!.args[2]).toEqual({ At: 1234 })
  })
})

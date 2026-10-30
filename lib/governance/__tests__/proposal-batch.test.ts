import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { blake2AsHex } from "@polkadot/util-crypto"
import { stringToU8a, u8aToHex } from "@polkadot/util"
import { INLINE_PROPOSAL_MAX_BYTES } from "@/lib/governance/preimage"
import { attachMetadataToExisting, buildProposalBatch } from "@/lib/governance/proposal-batch"

type Recorded = { call: string; args: unknown[] }

function fakeApi(sink: Recorded[]): ApiPromise {
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      sink.push({ call: name, args })
      return { __tx: name }
    }
  return {
    tx: {
      preimage: { notePreimage: rec("preimage.notePreimage") },
      referenda: {
        submit: rec("referenda.submit"),
        setMetadata: rec("referenda.setMetadata"),
      },
    },
  } as unknown as ApiPromise
}

const ENVELOPE = 'EGOV1:{"u":"https://x/p.json","h":"deadbeef"}'
const ENVELOPE_HASH = blake2AsHex(stringToU8a(ENVELOPE), 256)
const ROOT = { System: "Root" }
const AFTER = { type: "After" as const, block: 10 }

describe("buildProposalBatch", () => {
  it("submits small calls inline, without a preimage note", () => {
    const sink: Recorded[] = []
    const bytes = new Uint8Array([0, 7, 1])
    const built = buildProposalBatch(fakeApi(sink), {
      callBytes: bytes,
      origin: ROOT,
      enactment: AFTER,
      remarkPayload: ENVELOPE,
      referendumIndex: 5,
    })
    expect(built.inline).toBe(true)
    expect(sink.map((s) => s.call)).toEqual([
      "referenda.submit",
      "preimage.notePreimage",
      "referenda.setMetadata",
    ])
    expect(sink[0]!.args).toEqual([ROOT, { Inline: u8aToHex(bytes) }, { After: 10 }])
    expect(sink[2]!.args).toEqual([5, ENVELOPE_HASH])
    expect(built.metadataHash).toBe(ENVELOPE_HASH)
  })

  it("notes big calls (runtime code) and submits them by Lookup", () => {
    const sink: Recorded[] = []
    const bytes = new Uint8Array(4096).fill(9)
    const built = buildProposalBatch(fakeApi(sink), {
      callBytes: bytes,
      origin: ROOT,
      enactment: { type: "At", block: 999 },
      remarkPayload: ENVELOPE,
      referendumIndex: 6,
    })
    const hash = blake2AsHex(bytes, 256)
    expect(built).toMatchObject({ inline: false, preimageHash: hash, preimageLen: 4096 })
    expect(sink.map((s) => s.call)).toEqual([
      "preimage.notePreimage",
      "referenda.submit",
      "preimage.notePreimage",
      "referenda.setMetadata",
    ])
    expect(sink[1]!.args).toEqual([ROOT, { Lookup: { hash, len: 4096 } }, { At: 999 }])
  })

  it("skips the call note when its preimage is already on chain", () => {
    const sink: Recorded[] = []
    const built = buildProposalBatch(fakeApi(sink), {
      callBytes: new Uint8Array(500),
      origin: ROOT,
      enactment: AFTER,
      remarkPayload: ENVELOPE,
      referendumIndex: 7,
      skipNote: true,
    })
    expect(built.calls).toHaveLength(3)
    expect(sink[0]!.call).toBe("referenda.submit")
  })
})

describe("attachMetadataToExisting", () => {
  it("only notes the envelope and binds it to the given referendum", () => {
    const sink: Recorded[] = []
    const built = attachMetadataToExisting(fakeApi(sink), {
      remarkPayload: ENVELOPE,
      referendumIndex: 212,
    })
    expect(sink.map((s) => s.call)).toEqual(["preimage.notePreimage", "referenda.setMetadata"])
    expect(sink[1]!.args).toEqual([212, ENVELOPE_HASH])
    expect(built.metadataHash).toBe(ENVELOPE_HASH)
  })
})

/**
 * The batch itself, call by call: each fake builder returns a record of its
 * call and args, so these pin inline-vs-Lookup routing at the exact bound,
 * ordering, which bytes each note carries, and what setMetadata binds.
 */
describe("buildProposalBatch - batch contents", () => {
  type Built = { call: string; args: unknown[] }
  const record =
    (call: string) =>
    (...args: unknown[]): Built => ({ call, args })
  const api = {
    tx: {
      preimage: { notePreimage: record("preimage.notePreimage") },
      referenda: {
        submit: record("referenda.submit"),
        setMetadata: record("referenda.setMetadata"),
      },
    },
  } as unknown as ApiPromise

  const AFTER_0 = { type: "After", block: 0 } as const
  // system.authorizeUpgrade(code_hash): 2-byte call index + 32-byte hash.
  const SMALL_CALL = new Uint8Array(34).fill(7)
  const SMALL_HASH = blake2AsHex(SMALL_CALL, 256)
  // Exactly at the inline bound, and one byte past it.
  const MAX_CALL = new Uint8Array(INLINE_PROPOSAL_MAX_BYTES).fill(8)
  const BIG_CALL = new Uint8Array(INLINE_PROPOSAL_MAX_BYTES + 1).fill(9)
  const BIG_HASH = blake2AsHex(BIG_CALL, 256)

  const SUBMIT_INLINE: Built = {
    call: "referenda.submit",
    args: [ROOT, { Inline: u8aToHex(SMALL_CALL) }, { After: 0 }],
  }
  const NOTE_CALL: Built = { call: "preimage.notePreimage", args: [u8aToHex(BIG_CALL)] }
  const SUBMIT_LOOKUP: Built = {
    call: "referenda.submit",
    args: [ROOT, { Lookup: { hash: BIG_HASH, len: INLINE_PROPOSAL_MAX_BYTES + 1 } }, { After: 0 }],
  }
  const NOTE_ENVELOPE: Built = {
    call: "preimage.notePreimage",
    args: [u8aToHex(stringToU8a(ENVELOPE))],
  }
  const setMetadata = (index: number): Built => ({
    call: "referenda.setMetadata",
    args: [index, ENVELOPE_HASH],
  })

  function build(
    args: Partial<Parameters<typeof buildProposalBatch>[1]> & { callBytes: Uint8Array },
  ) {
    const built = buildProposalBatch(api, {
      origin: ROOT,
      enactment: AFTER_0,
      remarkPayload: ENVELOPE,
      referendumIndex: 3,
      ...args,
    })
    return { ...built, calls: built.calls as unknown as Built[] }
  }

  it("orders an inline submission as [submit, note(envelope), setMetadata]", () => {
    const built = build({ callBytes: SMALL_CALL, referendumIndex: 11 })
    expect(built).toMatchObject({ inline: true, preimageHash: SMALL_HASH, preimageLen: 34 })
    expect(built.calls).toEqual([SUBMIT_INLINE, NOTE_ENVELOPE, setMetadata(11)])
  })

  it("keeps a call of exactly the inline bound inline, and notes one byte more", () => {
    expect(build({ callBytes: MAX_CALL }).inline).toBe(true)
    const big = build({ callBytes: BIG_CALL })
    expect(big.inline).toBe(false)
    expect(big.calls).toEqual([NOTE_CALL, SUBMIT_LOOKUP, NOTE_ENVELOPE, setMetadata(3)])
  })

  it("drops only the call's note when skipNote is set, keeping the same Lookup", () => {
    expect(build({ callBytes: BIG_CALL, skipNote: true }).calls).toEqual([
      SUBMIT_LOOKUP,
      NOTE_ENVELOPE,
      setMetadata(3),
    ])
  })

  it("ignores skipNote for an inline call", () => {
    expect(build({ callBytes: SMALL_CALL, skipNote: true }).calls).toEqual([
      SUBMIT_INLINE,
      NOTE_ENVELOPE,
      setMetadata(3),
    ])
  })

  it("drops only the envelope's note when skipEnvelopeNote is set", () => {
    expect(build({ callBytes: BIG_CALL, skipEnvelopeNote: true }).calls).toEqual([
      NOTE_CALL,
      SUBMIT_LOOKUP,
      setMetadata(3),
    ])
  })

  it("binds setMetadata to the given index and the envelope's blake2-256", () => {
    const built = build({ callBytes: SMALL_CALL, referendumIndex: 42 })
    expect(built.calls.at(-1)).toEqual(setMetadata(42))
    expect(built.metadataHash).toBe(ENVELOPE_HASH)
    // Never the sha256 inside the envelope, nor the call's own hash.
    expect(built.metadataHash).not.toContain("deadbeef")
    expect(built.metadataHash).not.toBe(built.preimageHash)
  })

  it("passes origin and an At enactment through verbatim", () => {
    const built = build({
      callBytes: SMALL_CALL,
      origin: { Origins: "WhitelistedCaller" },
      enactment: { type: "At", block: 1234 },
    })
    expect(built.calls[0]!.args[0]).toEqual({ Origins: "WhitelistedCaller" })
    expect(built.calls[0]!.args[2]).toEqual({ At: 1234 })
  })
})

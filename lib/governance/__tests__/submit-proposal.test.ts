import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { blake2AsHex } from "@polkadot/util-crypto"
import { stringToU8a, u8aToHex } from "@polkadot/util"
import { INLINE_PROPOSAL_MAX_BYTES } from "@/lib/governance/preimage"
import { buildProposalSubmission } from "@/lib/governance/submit-proposal"

/**
 * buildProposalSubmission composes [notePreimage?, submit] plus, with
 * metadata, [notePreimage(envelope), setMetadata]. We fake `api.tx` so each
 * builder returns a record of its call and args, letting us assert on the
 * batch itself: inline-vs-Lookup routing, ordering, which bytes each note
 * carries, and that setMetadata binds the envelope's blake2-256 to the given
 * index.
 */

type Built = { call: string; args: unknown[] }

const record =
  (call: string) =>
  (...args: unknown[]): Built => ({ call, args })

const fakeApi = {
  tx: {
    preimage: { notePreimage: record("preimage.notePreimage") },
    referenda: {
      submit: record("referenda.submit"),
      setMetadata: record("referenda.setMetadata"),
    },
  },
} as unknown as ApiPromise

const ROOT = { System: "Root" }
const AFTER_0 = { type: "After", block: 0 } as const

// system.authorizeUpgrade(code_hash): 2-byte call index + 32-byte hash.
const SMALL_CALL = new Uint8Array(34).fill(7)
const SMALL_HASH = blake2AsHex(SMALL_CALL, 256)
// One byte past the inline bound - must be noted and referenced by Lookup.
const BIG_CALL = new Uint8Array(INLINE_PROPOSAL_MAX_BYTES + 1).fill(9)
const BIG_HASH = blake2AsHex(BIG_CALL, 256)

const ENVELOPE = 'EGOV1:{"u":"https://x/p.json","h":"deadbeef"}'
const ENVELOPE_HASH = blake2AsHex(stringToU8a(ENVELOPE), 256)

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
  args: Partial<Parameters<typeof buildProposalSubmission>[1]> & { callBytes: Uint8Array },
) {
  const built = buildProposalSubmission(fakeApi, { origin: ROOT, enactment: AFTER_0, ...args })
  return { ...built, calls: built.calls as unknown as Built[] }
}

describe("buildProposalSubmission", () => {
  it("submits a small call inline, with no preimage note", () => {
    const built = build({ callBytes: SMALL_CALL })
    expect(built.inline).toBe(true)
    expect(built.callHash).toBe(SMALL_HASH)
    expect(built.callLen).toBe(34)
    expect(built.metadataHash).toBeNull()
    expect(built.calls).toEqual([SUBMIT_INLINE])
  })

  it("notes a large call and submits it by Lookup", () => {
    const built = build({ callBytes: BIG_CALL })
    expect(built.inline).toBe(false)
    expect(built.callHash).toBe(BIG_HASH)
    expect(built.calls).toEqual([NOTE_CALL, SUBMIT_LOOKUP])
  })

  it("drops the call's notePreimage when skipNote is set, keeping the same Lookup", () => {
    expect(build({ callBytes: BIG_CALL, skipNote: true }).calls).toEqual([SUBMIT_LOOKUP])
  })

  it("ignores skipNote for an inline call", () => {
    expect(build({ callBytes: SMALL_CALL, skipNote: true }).calls).toEqual([SUBMIT_INLINE])
  })

  it("orders an inline submission with metadata as [submit, note(envelope), setMetadata]", () => {
    const built = build({
      callBytes: SMALL_CALL,
      metadata: { remarkPayload: ENVELOPE, referendumIndex: 11 },
    })
    expect(built.calls).toEqual([SUBMIT_INLINE, NOTE_ENVELOPE, setMetadata(11)])
  })

  it("orders a Lookup submission with metadata as [note(call), submit, note(envelope), setMetadata]", () => {
    const built = build({
      callBytes: BIG_CALL,
      metadata: { remarkPayload: ENVELOPE, referendumIndex: 3 },
    })
    expect(built.calls).toEqual([NOTE_CALL, SUBMIT_LOOKUP, NOTE_ENVELOPE, setMetadata(3)])
  })

  it("keeps the envelope note when skipNote drops the call's", () => {
    const built = build({
      callBytes: BIG_CALL,
      skipNote: true,
      metadata: { remarkPayload: ENVELOPE, referendumIndex: 3 },
    })
    expect(built.calls).toEqual([SUBMIT_LOOKUP, NOTE_ENVELOPE, setMetadata(3)])
  })

  it("binds setMetadata to the given index and the envelope's blake2-256", () => {
    const built = build({
      callBytes: SMALL_CALL,
      metadata: { remarkPayload: ENVELOPE, referendumIndex: 42 },
    })
    expect(built.calls.at(-1)).toEqual(setMetadata(42))
    expect(built.metadataHash).toBe(ENVELOPE_HASH)
    // Never the sha256 inside the envelope, nor the call's own hash.
    expect(built.metadataHash).not.toContain("deadbeef")
    expect(built.metadataHash).not.toBe(built.callHash)
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

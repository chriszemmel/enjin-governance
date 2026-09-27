import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { blake2AsHex } from "@polkadot/util-crypto"
import { stringToU8a, u8aToHex } from "@polkadot/util"
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

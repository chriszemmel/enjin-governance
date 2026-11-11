import { describe, expect, it } from "vitest"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import {
  findLandedSubmission,
  LANDED_SCAN_DEPTH,
  stagedForMismatch,
  type SubmissionReader,
} from "@/lib/governance/submission-checks"

const ALICE = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const BOB = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
/** The same wallet in the generic Substrate format an extension hands out. */
const ALICE_GENERIC = encodeAddress(decodeAddress(ALICE), 42)
const ENVELOPE = `0x${"ab".repeat(32)}`
const OTHER = `0x${"cd".repeat(32)}`

/** A chain where each index has a metadata hash and a depositor; records what was read. */
function fakeReader(refs: Record<number, { meta: string | null; depositor: string | null }>) {
  const read = { metadataOf: [] as number[], depositorOf: [] as number[] }
  const reader: SubmissionReader = {
    metadataOf: async (i) => {
      read.metadataOf.push(i)
      return refs[i]?.meta ?? null
    },
    depositorOf: async (i) => {
      read.depositorOf.push(i)
      return refs[i]?.depositor ?? null
    },
  }
  return { reader, read }
}

describe("findLandedSubmission", () => {
  it("finds the referendum an earlier attempt filed with this envelope", async () => {
    const { reader } = fakeReader({
      40: { meta: OTHER, depositor: ALICE },
      // Hex case doesn't matter.
      41: { meta: `0x${"AB".repeat(32)}`, depositor: ALICE },
      42: { meta: null, depositor: BOB },
    })
    const found = await findLandedSubmission(reader, {
      envelopeHash: ENVELOPE,
      proposer: ALICE,
      referendumCount: 43,
    })
    expect(found).toBe(41)
  })

  it("matches the depositor by public key, whatever the address format", async () => {
    const { reader } = fakeReader({ 7: { meta: ENVELOPE, depositor: ALICE } })
    expect(
      await findLandedSubmission(reader, {
        envelopeHash: ENVELOPE,
        proposer: ALICE_GENERIC,
        referendumCount: 8,
      }),
    ).toBe(7)
  })

  it("ignores another account's referendum that carries a copy of the envelope", async () => {
    const { reader } = fakeReader({
      10: { meta: ENVELOPE, depositor: BOB },
      11: { meta: ENVELOPE, depositor: null },
    })
    expect(
      await findLandedSubmission(reader, {
        envelopeHash: ENVELOPE,
        proposer: ALICE,
        referendumCount: 12,
      }),
    ).toBeNull()
  })

  it("returns null when no recent referendum carries the envelope", async () => {
    const { reader, read } = fakeReader({ 3: { meta: OTHER, depositor: ALICE } })
    expect(
      await findLandedSubmission(reader, {
        envelopeHash: ENVELOPE,
        proposer: ALICE,
        referendumCount: 5,
      }),
    ).toBeNull()
    // Only a matching hash costs a second read.
    expect(read.depositorOf).toEqual([])
  })

  it("reads only the last LANDED_SCAN_DEPTH indices below the count, never below 0", async () => {
    const deep = fakeReader({ 0: { meta: ENVELOPE, depositor: ALICE } })
    const count = LANDED_SCAN_DEPTH + 5
    expect(
      await findLandedSubmission(deep.reader, {
        envelopeHash: ENVELOPE,
        proposer: ALICE,
        referendumCount: count,
      }),
    ).toBeNull()
    expect(deep.read.metadataOf).toHaveLength(LANDED_SCAN_DEPTH)
    expect(Math.min(...deep.read.metadataOf)).toBe(count - LANDED_SCAN_DEPTH)
    expect(Math.max(...deep.read.metadataOf)).toBe(count - 1)

    const young = fakeReader({ 0: { meta: ENVELOPE, depositor: ALICE } })
    expect(
      await findLandedSubmission(young.reader, {
        envelopeHash: ENVELOPE,
        proposer: ALICE,
        referendumCount: 3,
      }),
    ).toBe(0)
    expect(young.read.metadataOf.sort()).toEqual([0, 1, 2])

    const empty = fakeReader({})
    expect(
      await findLandedSubmission(empty.reader, {
        envelopeHash: ENVELOPE,
        proposer: ALICE,
        referendumCount: 0,
      }),
    ).toBeNull()
    expect(empty.read.metadataOf).toEqual([])
  })

  it("throws when the chain can't be read, so the caller doesn't sign blind", async () => {
    const reader: SubmissionReader = {
      metadataOf: async () => {
        throw new Error("rpc down")
      },
      depositorOf: async () => null,
    }
    await expect(
      findLandedSubmission(reader, { envelopeHash: ENVELOPE, proposer: ALICE, referendumCount: 3 }),
    ).rejects.toThrow("rpc down")
  })
})

describe("stagedForMismatch", () => {
  const staged = { network: "enjin-relay" as const, proposer: ALICE }

  it("allows the account and network the draft was staged for, in any address format", () => {
    expect(stagedForMismatch(staged, { network: "enjin-relay", address: ALICE })).toBeNull()
    expect(stagedForMismatch(staged, { network: "enjin-relay", address: ALICE_GENERIC })).toBeNull()
  })

  it("refuses after a network switch", () => {
    const message = stagedForMismatch(staged, { network: "canary-relay", address: ALICE })
    expect(message).toMatch(/staged on Enjin Relay/)
    expect(message).toMatch(/Canary Relay is selected/)
  })

  it("refuses after an account switch or a disconnect", () => {
    expect(stagedForMismatch(staged, { network: "enjin-relay", address: BOB })).toMatch(
      /another account is connected/,
    )
    expect(stagedForMismatch(staged, { network: "enjin-relay", address: null })).not.toBeNull()
    expect(stagedForMismatch(staged, { network: "enjin-relay", address: "garbage" })).not.toBeNull()
  })
})

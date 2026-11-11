import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { compactAddLength, stringToU8a } from "@polkadot/util"
import { blake2AsHex } from "@polkadot/util-crypto"
import {
  getPreimageDepositsFor,
  holdOngoingProposals,
  isEnvelopeBytes,
  markProposalRecords,
  type PreimageDeposit,
} from "@/lib/governance/deposits"
import type { Referendum } from "@/lib/governance/types"

/**
 * A proposal's EGOV1 envelope is noted as a preimage and bound with
 * `referenda.setMetadata`, which doesn't request it - on Enjin mainnet and
 * canary every envelope sits Unrequested with the proposer's ticket, even
 * while its referendum is Ongoing. So the runtime lets the proposer unnote
 * it, which breaks `MetadataOf` → preimage → `EGOV1:{u,h}`. The same goes
 * for an Ongoing referendum's proposal call (mainnet #12-#14 are all
 * Unrequested), which would leave the referendum nothing to enact. These
 * tests pin how such preimages are recognised so the panel keeps them out
 * of the routine reclaim flow.
 */

const referenda = vi.hoisted(() => ({ ongoing: [] as Referendum[] }))

vi.mock("@/lib/governance/referenda", () => ({
  listReferenda: vi.fn(async (_api: unknown, filter: { status?: string }) =>
    filter.status === "Ongoing" ? referenda.ongoing : [],
  ),
}))

beforeEach(() => {
  referenda.ongoing = []
})

const ME = "enAlice"
const OTHER = "enBob"

const ENVELOPE = `EGOV1:{"u":"https://gov.example/r/proposals/abc/proposal.json","h":"${"ab".repeat(32)}"}`
const ENVELOPE_BYTES = stringToU8a(ENVELOPE)
const ENVELOPE_HASH = blake2AsHex(ENVELOPE_BYTES, 256) as `0x${string}`

const CALL_BYTES = new Uint8Array([0x28, 0x03, 0x00, 0x01, 0x02, 0x03])
const CALL_HASH = blake2AsHex(CALL_BYTES, 256) as `0x${string}`

/** The deposit mainnet holds for a 183-byte envelope (≈1.006 ENJ). */
const ENVELOPE_DEPOSIT = "0x00000000000000000df6a6d4e0e0f000"

type Noted = { hash: `0x${string}`; who: string; bytes: Uint8Array; requested?: boolean }

/**
 * Fake `api` over a preimage pallet + referenda.metadataOf. Records which
 * preimages had their bytes downloaded.
 */
function fakeApi(noted: Noted[], metadataOf: Record<number, `0x${string}`>) {
  const bytesRead: string[] = []
  const api = {
    query: {
      preimage: {
        requestStatusFor: {
          entries: async () =>
            noted.map((n) => [
              { args: [{ toHex: () => n.hash }] },
              {
                toJSON: () =>
                  n.requested
                    ? {
                        requested: {
                          maybeTicket: [n.who, ENVELOPE_DEPOSIT],
                          maybeLen: n.bytes.length,
                        },
                      }
                    : { unrequested: { ticket: [n.who, ENVELOPE_DEPOSIT], len: n.bytes.length } },
              },
            ]),
        },
        preimageFor: async ([hash, len]: [string, number]) => {
          bytesRead.push(hash)
          const hit = noted.find((n) => n.hash === hash && n.bytes.length === len)
          return {
            isSome: hit != null,
            // A `Bytes` codec: non-bare output carries a compact length prefix.
            unwrap: () => ({
              toU8a: (isBare?: boolean) => (isBare ? hit!.bytes : compactAddLength(hit!.bytes)),
            }),
          }
        },
      },
      referenda: {
        metadataOf: {
          entries: async () =>
            Object.entries(metadataOf).map(([index, hash]) => [
              { args: [{ toNumber: () => Number(index) }] },
              { isSome: true, unwrap: () => ({ toHex: () => hash }) },
            ]),
        },
      },
    },
  } as unknown as ApiPromise
  return { api, bytesRead }
}

function deposit(hash: `0x${string}`, extra: Partial<PreimageDeposit> = {}): PreimageDeposit {
  return { hash, len: 10, amount: 1n, unnotable: true, ...extra }
}

/** An Ongoing referendum whose proposal is the noted preimage `hash`. */
function ongoingWithProposal(index: number, hash: `0x${string}`, len: number): Referendum {
  return {
    index,
    trackId: 203,
    tally: null,
    status: {
      type: "Ongoing",
      trackId: 203,
      origin: {},
      proposal: { hash, len },
      enactment: { type: "After", block: 0 },
      submitted: 0,
      submissionDeposit: { who: ME, amount: 1n },
      decisionDeposit: null,
      deciding: null,
      tally: { ayes: 0n, nays: 0n, support: 0n },
      inQueue: false,
      alarm: null,
    },
  }
}

describe("isEnvelopeBytes", () => {
  it("recognises the EGOV1 magic prefix", () => {
    expect(isEnvelopeBytes(ENVELOPE_BYTES)).toBe(true)
    expect(isEnvelopeBytes(stringToU8a("EGOV1:"))).toBe(true)
  })

  it("rejects other bytes", () => {
    expect(isEnvelopeBytes(CALL_BYTES)).toBe(false)
    expect(isEnvelopeBytes(stringToU8a("egov1:{}"))).toBe(false)
    expect(isEnvelopeBytes(stringToU8a("EGOV2:{}"))).toBe(false)
    expect(isEnvelopeBytes(stringToU8a("EGOV1"))).toBe(false)
    expect(isEnvelopeBytes(new Uint8Array())).toBe(false)
    expect(isEnvelopeBytes(null)).toBe(false)
    expect(isEnvelopeBytes(undefined)).toBe(false)
  })
})

describe("markProposalRecords", () => {
  it("binds a MetadataOf target to its referendum, whatever the hash's case", () => {
    const [d] = markProposalRecords(
      [deposit(ENVELOPE_HASH.toUpperCase().replace("0X", "0x") as `0x${string}`)],
      new Map([[ENVELOPE_HASH.toLowerCase(), 14]]),
      new Set(),
    )
    expect(d.proposalRecord).toEqual({ referendumIndex: 14 })
  })

  it("flags EGOV1 bytes no referendum points at with a null index", () => {
    const [d] = markProposalRecords([deposit(ENVELOPE_HASH)], new Map(), new Set([ENVELOPE_HASH]))
    expect(d.proposalRecord).toEqual({ referendumIndex: null })
  })

  it("prefers the MetadataOf binding when both match", () => {
    const [d] = markProposalRecords(
      [deposit(ENVELOPE_HASH)],
      new Map([[ENVELOPE_HASH, 3]]),
      new Set([ENVELOPE_HASH]),
    )
    expect(d.proposalRecord).toEqual({ referendumIndex: 3 })
  })

  it("leaves other deposits untouched", () => {
    const plain = deposit(CALL_HASH)
    const [d] = markProposalRecords([plain], new Map([[ENVELOPE_HASH, 1]]), new Set())
    expect(d).toBe(plain)
    expect(d).not.toHaveProperty("proposalRecord")
  })
})

describe("holdOngoingProposals", () => {
  it("holds back an Ongoing referendum's proposal, whatever the hash's case", () => {
    const upper = `0x${CALL_HASH.slice(2).toUpperCase()}` as `0x${string}`
    const [held] = holdOngoingProposals([deposit(upper)], new Set([CALL_HASH]))
    expect(held.unnotable).toBe(false)
  })

  it("leaves other deposits untouched", () => {
    const plain = deposit(ENVELOPE_HASH)
    expect(holdOngoingProposals([plain], new Set([CALL_HASH]))[0]).toBe(plain)
  })
})

describe("getPreimageDepositsFor - proposal records", () => {
  it("flags the envelope its referendum's MetadataOf binds, still unnotable per the runtime", async () => {
    const { api, bytesRead } = fakeApi([{ hash: ENVELOPE_HASH, who: ME, bytes: ENVELOPE_BYTES }], {
      12: ENVELOPE_HASH,
    })
    const out = await getPreimageDepositsFor(api, ME)
    expect(out).toEqual([
      {
        hash: ENVELOPE_HASH,
        len: ENVELOPE_BYTES.length,
        amount: BigInt(ENVELOPE_DEPOSIT),
        unnotable: true,
        proposalRecord: { referendumIndex: 12 },
      },
    ])
    // Bound by MetadataOf already - no need to download the bytes.
    expect(bytesRead).toEqual([])
  })

  it("flags an unbound EGOV1 envelope by its bytes", async () => {
    const { api } = fakeApi([{ hash: ENVELOPE_HASH, who: ME, bytes: ENVELOPE_BYTES }], {})
    const [d] = await getPreimageDepositsFor(api, ME)
    expect(d.proposalRecord).toEqual({ referendumIndex: null })
  })

  it("leaves a proposal call no Ongoing referendum uses as a routine reclaim", async () => {
    const { api } = fakeApi([{ hash: CALL_HASH, who: ME, bytes: CALL_BYTES }], {})
    const [d] = await getPreimageDepositsFor(api, ME)
    expect(d.unnotable).toBe(true)
    expect(d.proposalRecord).toBeUndefined()
  })

  it("holds back the proposal call of an Ongoing referendum, though it's Unrequested", async () => {
    referenda.ongoing = [ongoingWithProposal(14, CALL_HASH, CALL_BYTES.length)]
    const { api } = fakeApi(
      [
        { hash: CALL_HASH, who: ME, bytes: CALL_BYTES },
        { hash: ENVELOPE_HASH, who: ME, bytes: ENVELOPE_BYTES },
      ],
      { 14: ENVELOPE_HASH },
    )
    const out = await getPreimageDepositsFor(api, ME)
    expect(out.find((d) => d.hash === CALL_HASH)).toMatchObject({ unnotable: false })
    // Its envelope stays reclaimable per the runtime, behind the record flag.
    expect(out.find((d) => d.hash === ENVELOPE_HASH)).toMatchObject({
      unnotable: true,
      proposalRecord: { referendumIndex: 14 },
    })
  })

  it("doesn't download preimages too large to be an envelope", async () => {
    const big = new Uint8Array(5_000).fill(1)
    const bigHash = blake2AsHex(big, 256) as `0x${string}`
    const { api, bytesRead } = fakeApi([{ hash: bigHash, who: ME, bytes: big }], {})
    const [d] = await getPreimageDepositsFor(api, ME)
    expect(d.proposalRecord).toBeUndefined()
    expect(bytesRead).toEqual([])
  })

  it("only returns the address's own deposits", async () => {
    const { api, bytesRead } = fakeApi(
      [
        { hash: ENVELOPE_HASH, who: OTHER, bytes: ENVELOPE_BYTES },
        { hash: CALL_HASH, who: ME, bytes: CALL_BYTES },
      ],
      { 7: ENVELOPE_HASH },
    )
    const out = await getPreimageDepositsFor(api, ME)
    expect(out.map((d) => d.hash)).toEqual([CALL_HASH])
    expect(bytesRead).toEqual([CALL_HASH])
  })

  it("reads nothing more when the address has no preimage deposits", async () => {
    const { api, bytesRead } = fakeApi(
      [{ hash: ENVELOPE_HASH, who: OTHER, bytes: ENVELOPE_BYTES }],
      { 7: ENVELOPE_HASH },
    )
    expect(await getPreimageDepositsFor(api, ME)).toEqual([])
    expect(bytesRead).toEqual([])
  })

  it("keeps a Requested envelope non-unnotable but still flagged", async () => {
    const { api } = fakeApi(
      [{ hash: ENVELOPE_HASH, who: ME, bytes: ENVELOPE_BYTES, requested: true }],
      { 9: ENVELOPE_HASH },
    )
    const [d] = await getPreimageDepositsFor(api, ME)
    expect(d.unnotable).toBe(false)
    expect(d.proposalRecord).toEqual({ referendumIndex: 9 })
  })
})

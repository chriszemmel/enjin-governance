import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import type { EventRecord } from "@polkadot/types/interfaces"
import {
  buildPlaceDecisionDeposit,
  buildRefundDecisionDeposit,
  buildRefundSubmissionDeposit,
  buildSetMetadata,
  buildSubmit,
  extractReferendumIndex,
  getDecidedTrack,
  getReferendum,
  getReferendumCount,
  getReferendumHistory,
  listReferenda,
} from "@/lib/governance/referenda"
import { defined } from "@/test/defined"

/**
 * The readers of referenda.ts (list / one / history / count) and the
 * deposit builders, against plain-object codec fakes like status.test.ts.
 */

const asApi = (fake: object) => fake as unknown as ApiPromise
const num = (n: number) => ({ toNumber: () => n })
const big = (b: bigint) => ({ toBigInt: () => b, toString: () => b.toString() })
const acct = (s: string) => ({ toString: () => s })
const some = (v: unknown) => ({ isSome: true, unwrap: () => v })
const none = () => ({ isSome: false, unwrap: () => undefined })

function ongoing(track: number) {
  return some({
    isOngoing: true,
    asOngoing: {
      track: num(track),
      origin: {},
      proposal: { isLookup: true, asLookup: { toJSON: () => ({ hash: "0xabc", len: 42 }) } },
      enactment: { isAfter: true, asAfter: num(0) },
      submitted: num(1_000),
      submissionDeposit: { who: acct("alice"), amount: big(10n) },
      decisionDeposit: none(),
      deciding: none(),
      tally: { ayes: big(1n), nays: big(0n), support: big(1n) },
      inQueue: { valueOf: () => false },
      alarm: none(),
    },
  })
}
const approved = (at: number) => some({ isApproved: true, asApproved: [num(at), none(), none()] })

function referendaApi(entries: Array<[number, unknown]>, pallet = "referenda") {
  return asApi({
    query: {
      [pallet]: {
        referendumInfoFor: Object.assign(
          async (index: number) => entries.find(([i]) => i === index)?.[1] ?? none(),
          { entries: async () => entries.map(([i, info]) => [{ args: [num(i)] }, info]) },
        ),
        referendumCount: async () => num(entries.length),
      },
    },
  })
}

describe("listReferenda", () => {
  const api = referendaApi([
    [1, ongoing(2)],
    [4, ongoing(5)],
    [2, approved(9_000)],
    [3, none()],
  ])

  it("decodes every referendum, newest first, skipping empty entries", async () => {
    expect((await listReferenda(api)).map((r) => r.index)).toEqual([4, 2, 1])
  })

  it("filters by track and by status", async () => {
    expect((await listReferenda(api, { trackId: 2 })).map((r) => r.index)).toEqual([1])
    expect((await listReferenda(api, { status: "Approved" })).map((r) => r.index)).toEqual([2])
  })

  it("reads the fellowship pallet when asked", async () => {
    const fellowship = referendaApi([[0, approved(5)]], "fellowshipReferenda")
    expect(
      (await listReferenda(fellowship, {}, "fellowshipReferenda")).map((r) => r.index),
    ).toEqual([0])
  })

  it("refuses a chain without the pallet", async () => {
    await expect(listReferenda(asApi({ query: {} }))).rejects.toThrow(
      /referenda\.referendumInfoFor/,
    )
  })
})

describe("getReferendum / getReferendumCount", () => {
  const api = referendaApi([
    [0, ongoing(3)],
    [1, approved(9)],
  ])

  it("reads one referendum, null for an unknown index", async () => {
    expect(defined(await getReferendum(api, 0)).trackId).toBe(3)
    expect(await getReferendum(api, 7)).toBeNull()
  })

  it("counts the referenda ever submitted", async () => {
    expect(await getReferendumCount(api)).toBe(2)
  })
})

describe("getReferendumHistory", () => {
  function archive(info: unknown, fail = false) {
    const asked: unknown[] = []
    const api = asApi({
      rpc: {
        chain: {
          getBlockHash: async (block: number) => {
            asked.push(block)
            if (fail) throw new Error("pruned")
            return `hash-${block}`
          },
        },
      },
      at: async () => ({ query: { referenda: { referendumInfoFor: async () => info } } }),
    })
    return { api, asked }
  }

  it("reads the referendum at the block before its decision", async () => {
    const { api, asked } = archive(ongoing(4))
    const ref = await getReferendumHistory(api, 9, 500)
    expect(defined(ref).trackId).toBe(4)
    expect(asked).toEqual([499])
  })

  it("is null for an impossible block or pruned state", async () => {
    expect(await getReferendumHistory(archive(ongoing(4)).api, 9, 1)).toBeNull()
    expect(await getReferendumHistory(archive(ongoing(4), true).api, 9, 500)).toBeNull()
  })
})

describe("getDecidedTrack", () => {
  it("reads an unwrapped storage value and is null when the read fails", async () => {
    const api = (raw: unknown) =>
      asApi({
        rpc: {
          chain: { getBlockHash: async () => "0xhash" },
          state: { getStorage: async () => raw },
        },
        query: { referenda: { referendumInfoFor: { key: () => "0xkey" } } },
      })
    // Ongoing (0), track 0x0102 little-endian = 513
    expect(await getDecidedTrack(api({ toU8a: () => new Uint8Array([0, 1, 2, 9]) }), 3, 100)).toBe(
      513,
    )
    const failing = asApi({
      rpc: { chain: { getBlockHash: async () => Promise.reject(new Error("down")) } },
      query: { referenda: { referendumInfoFor: { key: () => "0xkey" } } },
    })
    expect(await getDecidedTrack(failing, 3, 100)).toBeNull()
  })
})

describe("extractReferendumIndex", () => {
  it("is null when the Submitted event's index can't be read", () => {
    const events = [
      {
        event: { section: "referenda", method: "Submitted", data: [{}] },
      },
    ] as unknown as EventRecord[]
    expect(extractReferendumIndex(events)).toBeNull()
  })
})

describe("extrinsic builders", () => {
  function recordingApi() {
    const calls: Array<[string, unknown[]]> = []
    const rec =
      (name: string) =>
      (...a: unknown[]) => {
        calls.push([name, a])
        return { __tx: name }
      }
    const pallet = (p: string) => ({
      submit: rec(`${p}.submit`),
      setMetadata: rec(`${p}.setMetadata`),
      placeDecisionDeposit: rec(`${p}.placeDecisionDeposit`),
      refundSubmissionDeposit: rec(`${p}.refundSubmissionDeposit`),
      refundDecisionDeposit: rec(`${p}.refundDecisionDeposit`),
    })
    const api = asApi({
      tx: { referenda: pallet("referenda"), fellowshipReferenda: pallet("fellowshipReferenda") },
    })
    return { api, calls }
  }

  it("builds the deposit calls for exactly the given referendum", () => {
    const { api, calls } = recordingApi()
    buildPlaceDecisionDeposit(api, 11)
    buildRefundSubmissionDeposit(api, 12)
    buildRefundDecisionDeposit(api, 13)
    expect(calls).toEqual([
      ["referenda.placeDecisionDeposit", [11]],
      ["referenda.refundSubmissionDeposit", [12]],
      ["referenda.refundDecisionDeposit", [13]],
    ])
  })

  it("submits and sets metadata on the fellowship pallet when asked", () => {
    const { api, calls } = recordingApi()
    buildSubmit(api, {
      origin: { FellowshipOrigins: "Fellows" },
      proposal: { hash: "0xabc", len: 3 },
      enactment: { type: "After", block: 1 },
      pallet: "fellowshipReferenda",
    })
    buildSetMetadata(api, 2, "0xdef", "fellowshipReferenda")
    expect(calls.map(([name]) => name)).toEqual([
      "fellowshipReferenda.submit",
      "fellowshipReferenda.setMetadata",
    ])
    expect(defined(calls[1])[1]).toEqual([2, "0xdef"])
  })
})

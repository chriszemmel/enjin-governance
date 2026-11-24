import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import {
  decodeTaskAddress,
  enactmentTaskName,
  readEnactmentRecord,
  readEnactmentTask,
} from "@/lib/governance/scheduler"

/**
 * The archive-reading half of scheduler.ts, against a fake archive api that
 * serves `scheduler.lookup` and `system.events` per block. The numbers are
 * mainnet referendum #12's (see the module comment).
 */

const asApi = (fake: object) => fake as unknown as ApiPromise
const num = (n: number) => ({ toNumber: () => n })
const some = (v: unknown) => ({ isSome: true, unwrap: () => v })
const none = () => ({ isSome: false, unwrap: () => undefined })

const APPROVED_AT = 17_533_282
const RUNS_AT = 17_547_682
const NAME = enactmentTaskName(12)

function dispatched(taskName: string | null, ok: boolean) {
  return {
    event: {
      section: "scheduler",
      method: "Dispatched",
      data: [
        [num(RUNS_AT), num(0)],
        taskName == null ? none() : some({ toHex: () => taskName }),
        { isOk: ok },
      ],
    },
  }
}

function spendApproved(index: number, amount: bigint, beneficiary: Uint8Array | null) {
  return {
    event: {
      section: "treasury",
      method: "SpendApproved",
      data: [
        num(index),
        { toBigInt: () => amount, toString: () => amount.toString() },
        beneficiary ? { toU8a: () => beneficiary } : {},
      ],
    },
  }
}

/** An archive whose state at each block hash is `states[block]`. */
function archive(opts: { head: number; lookupAtApproval: unknown; eventsAtRun?: unknown[] }) {
  return asApi({
    rpc: {
      chain: {
        getBlockHash: async (block: number) => `hash-${block}`,
        getHeader: async () => ({ number: num(opts.head) }),
      },
    },
    at: async (hash: string) => ({
      query: {
        scheduler: {
          lookup: async (name: string) => {
            expect(name).toBe(NAME)
            return hash === `hash-${APPROVED_AT}` ? opts.lookupAtApproval : none()
          },
        },
        system: {
          events: async () => (hash === `hash-${RUNS_AT}` ? (opts.eventsAtRun ?? []) : []),
        },
      },
    }),
  })
}

describe("decodeTaskAddress - shapes", () => {
  it("accepts an unwrapped tuple and rejects a short one", () => {
    expect(decodeTaskAddress([num(5), num(1)])).toEqual({ block: 5, index: 1 })
    expect(decodeTaskAddress([num(5)])).toBeNull()
    expect(decodeTaskAddress(null)).toBeNull()
  })

  it("reads bigint-like and plain numbers", () => {
    expect(decodeTaskAddress([{ toBigInt: () => 9n }, "2"])).toEqual({ block: 9, index: 2 })
    expect(decodeTaskAddress([null, 0])).toEqual({ block: 0, index: 0 })
  })
})

describe("readEnactmentTask", () => {
  it("looks up the referendum's named task", async () => {
    let asked: unknown
    const api = asApi({
      query: {
        scheduler: {
          lookup: async (name: unknown) => {
            asked = name
            return some([num(RUNS_AT), num(0)])
          },
        },
      },
    })
    expect(await readEnactmentTask(api, 12)).toEqual({ block: RUNS_AT, index: 0 })
    expect(asked).toBe(NAME)
  })

  it("refuses a chain without a scheduler", async () => {
    await expect(readEnactmentTask(asApi({ query: {} }), 12)).rejects.toThrow(/scheduler\.lookup/)
  })
})

describe("readEnactmentRecord", () => {
  const beneficiary = new Uint8Array(32).fill(0xab)

  it("reports the dispatch result and the spends our task emitted", async () => {
    const api = archive({
      head: RUNS_AT + 10,
      lookupAtApproval: some([num(RUNS_AT), num(0)]),
      eventsAtRun: [
        // an earlier task in the same block, with its own spend
        spendApproved(5, 1n, beneficiary),
        dispatched("0xother", true),
        { event: { section: "system", method: "ExtrinsicSuccess", data: [] } },
        spendApproved(6, 30_000n * 10n ** 18n, beneficiary),
        dispatched(NAME.toUpperCase(), true),
      ],
    })
    expect(await readEnactmentRecord(api, 12, APPROVED_AT)).toEqual({
      block: RUNS_AT,
      ok: true,
      spends: [
        {
          proposalIndex: 6,
          amount: 30_000n * 10n ** 18n,
          beneficiary: `0x${"ab".repeat(32)}`,
        },
      ],
    })
  })

  it("reports a failed dispatch, and no result when the task isn't in the block", async () => {
    const failed = archive({
      head: RUNS_AT,
      lookupAtApproval: some([num(RUNS_AT), num(0)]),
      eventsAtRun: [dispatched(NAME, false)],
    })
    expect(await readEnactmentRecord(failed, 12, APPROVED_AT)).toMatchObject({ ok: false })

    const missing = archive({
      head: RUNS_AT,
      lookupAtApproval: some([num(RUNS_AT), num(0)]),
      eventsAtRun: [dispatched(null, true), {}, { event: { section: "x" } }],
    })
    expect(await readEnactmentRecord(missing, 12, APPROVED_AT)).toEqual({
      block: RUNS_AT,
      ok: null,
      spends: [],
    })
  })

  it("is null when nothing was scheduled or the block isn't reached yet", async () => {
    expect(
      await readEnactmentRecord(
        archive({ head: RUNS_AT, lookupAtApproval: none() }),
        12,
        APPROVED_AT,
      ),
    ).toBeNull()
    expect(
      await readEnactmentRecord(
        archive({ head: RUNS_AT - 1, lookupAtApproval: some([num(RUNS_AT), num(0)]) }),
        12,
        APPROVED_AT,
      ),
    ).toBeNull()
  })

  it("records a spend without a readable beneficiary as 0x", async () => {
    const api = archive({
      head: RUNS_AT,
      lookupAtApproval: some([num(RUNS_AT), num(0)]),
      eventsAtRun: [spendApproved(7, 5n, null), dispatched(NAME, true)],
    })
    const record = await readEnactmentRecord(api, 12, APPROVED_AT)
    expect(record?.spends).toEqual([{ proposalIndex: 7, amount: 5n, beneficiary: "0x" }])
  })
})

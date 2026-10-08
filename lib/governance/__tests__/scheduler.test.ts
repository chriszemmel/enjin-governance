import { u8aToHex } from "@polkadot/util"
import { describe, expect, it } from "vitest"
import {
  decodeTaskAddress,
  enactmentBlock,
  enactmentOutcome,
  enactmentTaskKey,
  enactmentTaskName,
  type SchedulerEvent,
} from "@/lib/governance/scheduler"

/**
 * Computed once with @polkadot from Node against
 * wss://archive.relay.blockchain.enjin.io: at block 17,533,282 (where #12
 * was approved) `scheduler.lookup` of this name returned [17547682, 0], and
 * the `scheduler.Dispatched` event at 17,547,682 carries it as its `id`.
 */
const REFERENDUM_12_TASK = "0xab859d89da788592afd774660e59abe48bdfc6985ac9fc97f5579901b33f8e12"

describe("enactmentTaskName", () => {
  it('SCALE-encodes ([u8;8] b"assembly", Bytes "enactment", u32 index)', () => {
    expect(u8aToHex(enactmentTaskKey(12))).toBe(
      // "assembly" · compact(9) · "enactment" · 12u32 LE
      "0x617373656d626c79" + "24" + "656e6163746d656e74" + "0c000000",
    )
  })

  it("matches the name mainnet's scheduler.lookup used for referendum #12", () => {
    expect(enactmentTaskName(12)).toBe(REFERENDUM_12_TASK)
  })

  it("differs per index", () => {
    expect(enactmentTaskName(13)).not.toBe(REFERENDUM_12_TASK)
  })

  it("rejects an index that isn't a u32", () => {
    expect(() => enactmentTaskName(-1)).toThrow()
    expect(() => enactmentTaskName(2 ** 32)).toThrow()
    expect(() => enactmentTaskName(1.5)).toThrow()
  })
})

describe("enactmentBlock", () => {
  // #12: approved at 17,533,282 on a track with a 14,400-block minimum.
  const approval = 17_533_282
  const min = 14_400

  it("After(0) → approval + the track's min enactment period", () => {
    expect(enactmentBlock({ type: "After", block: 0 }, approval, min)).toBe(17_547_682)
  })

  it("After(n) beyond the minimum → approval + n", () => {
    expect(enactmentBlock({ type: "After", block: 20_000 }, approval, min)).toBe(approval + 20_000)
  })

  it("After(n) below the minimum is clamped up", () => {
    expect(enactmentBlock({ type: "After", block: 100 }, approval, min)).toBe(approval + min)
  })

  it("At(b) past the minimum → b", () => {
    expect(enactmentBlock({ type: "At", block: 17_600_000 }, approval, min)).toBe(17_600_000)
  })

  it("At(b) too soon (or in the past) is clamped to approval + minimum", () => {
    expect(enactmentBlock({ type: "At", block: 17_540_000 }, approval, min)).toBe(approval + min)
    expect(enactmentBlock({ type: "At", block: 1 }, approval, min)).toBe(approval + min)
  })

  it("never the approval block itself: at least the next block", () => {
    expect(enactmentBlock({ type: "After", block: 0 }, approval, 0)).toBe(approval + 1)
  })
})

describe("decodeTaskAddress", () => {
  it("decodes Some((block, index))", () => {
    const some = {
      isSome: true,
      unwrap: () => [{ toNumber: () => 17_547_682 }, { toNumber: () => 0 }],
    }
    expect(decodeTaskAddress(some)).toEqual({ block: 17_547_682, index: 0 })
  })

  it("None → null", () => {
    expect(decodeTaskAddress({ isSome: false, isNone: true, unwrap: () => null })).toBeNull()
    expect(decodeTaskAddress(null)).toBeNull()
  })
})

describe("enactmentOutcome", () => {
  const spend = (proposalIndex: number): SchedulerEvent => ({
    kind: "spendApproved",
    proposalIndex,
    amount: 30_000n * 10n ** 18n,
    beneficiary: "0x01",
  })
  const dispatched = (taskName: string | null, ok = true): SchedulerEvent => ({
    kind: "dispatched",
    taskName,
    ok,
  })

  it("#12 at 17,547,682: SpendApproved #6, then Dispatched Ok", () => {
    expect(
      enactmentOutcome([spend(6), dispatched(REFERENDUM_12_TASK)], REFERENDUM_12_TASK),
    ).toEqual({
      ok: true,
      spends: [{ proposalIndex: 6, amount: 30_000n * 10n ** 18n, beneficiary: "0x01" }],
    })
  })

  it("keeps only the spends emitted by our task when several run in one block", () => {
    const events: SchedulerEvent[] = [
      spend(5),
      dispatched("0xother"),
      { kind: "other" },
      spend(6),
      dispatched(REFERENDUM_12_TASK.toUpperCase().replace("0X", "0x")),
      spend(7),
      dispatched(null),
    ]
    const outcome = enactmentOutcome(events, REFERENDUM_12_TASK)
    expect(outcome.ok).toBe(true)
    expect(outcome.spends.map((s) => s.proposalIndex)).toEqual([6])
  })

  it("a failed dispatch", () => {
    expect(enactmentOutcome([dispatched(REFERENDUM_12_TASK, false)], REFERENDUM_12_TASK)).toEqual({
      ok: false,
      spends: [],
    })
  })

  it("no Dispatched for our task → ok null", () => {
    expect(enactmentOutcome([spend(6), dispatched("0xother")], REFERENDUM_12_TASK)).toEqual({
      ok: null,
      spends: [],
    })
  })
})

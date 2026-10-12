/**
 * A passed referendum's enactment, as the referenda pallet hands it to the
 * scheduler (`pallet_referenda::Pallet::schedule_enactment`):
 *
 *   schedule_named(
 *     blake2_256(("assembly", "enactment", index).encode()),
 *     At(max(desired.evaluate(now), now + max(track.min_enactment_period, 1))),
 *     …, call,
 *   )
 *
 * where `now` is the block the referendum was approved at. The named task
 * is stored in `scheduler.lookup(name) → (block, index)` until it runs, so:
 *   - lookup present: the call is still waiting (Enact is in progress);
 *   - lookup absent: it ran (or was cancelled by root). The block it ran at
 *     is recovered from the archive: the lookup at the approval block, then
 *     the scheduler's `Dispatched` event at that block.
 *
 * Mainnet referendum #12 (MediumSpender, spend_local 30,000 ENJ): approved at
 * 17,533,282, lookup there `[17547682, 0]` (approval + 14,400, the track's
 * min enactment, since the desired enactment was `After(0)`), dispatched Ok
 * at 17,547,682 with `treasury.SpendApproved` proposal #6.
 */

import type { ApiPromise } from "@polkadot/api"
import { bnToU8a, compactAddLength, stringToU8a, u8aConcat, u8aToHex } from "@polkadot/util"
import { blake2AsHex } from "@polkadot/util-crypto"

/** `pallet_referenda::ASSEMBLY_ID`, a `[u8; 8]` (no length prefix). */
const ASSEMBLY_ID = stringToU8a("assembly")
/** The `&str` "enactment": compact length, then the bytes. */
const ENACTMENT = compactAddLength(stringToU8a("enactment"))

/** SCALE encoding of `(ASSEMBLY_ID, "enactment", index)`, index a u32. */
export function enactmentTaskKey(index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > 0xffff_ffff) {
    throw new Error(`Referendum index must be a u32, got ${index}`)
  }
  return u8aConcat(ASSEMBLY_ID, ENACTMENT, bnToU8a(index, { bitLength: 32, isLe: true }))
}

/** The scheduler task name the referenda pallet enacts referendum `index` under. */
export function enactmentTaskName(index: number): `0x${string}` {
  return blake2AsHex(enactmentTaskKey(index), 256)
}

/** A referendum's desired enactment moment, as submitted. */
type DesiredEnactment = { type: "At" | "After"; block: number }

/**
 * The block the runtime schedules a passed referendum's call for:
 * `max(desired, approvalBlock + max(minEnactmentPeriod, 1))`, where
 * `After(n)` means approvalBlock + n and `At(b)` means b.
 */
export function enactmentBlock(
  desired: DesiredEnactment,
  approvalBlock: number,
  minEnactmentPeriod: number,
): number {
  const earliest = approvalBlock + Math.max(minEnactmentPeriod, 1)
  const wanted = desired.type === "At" ? desired.block : approvalBlock + desired.block
  return Math.max(wanted, earliest)
}

/** A scheduler `TaskAddress`: the block a task runs at and its slot in that block's agenda. */
export type TaskAddress = { block: number; index: number }

/** Decode `Option<(BlockNumber, u32)>` as returned by `scheduler.lookup`. */
export function decodeTaskAddress(raw: unknown): TaskAddress | null {
  if (raw == null) return null
  const opt = raw as { isSome?: boolean; isNone?: boolean; unwrap?: () => unknown }
  let inner: unknown = raw
  if (typeof opt.isSome === "boolean") {
    if (!opt.isSome) return null
    inner = opt.unwrap?.()
  }
  const tuple = inner as ArrayLike<unknown> | null
  if (!tuple || tuple.length < 2) return null
  return { block: toNumber(tuple[0]), index: toNumber(tuple[1]) }
}

/** Where the enactment of referendum `index` is waiting in the scheduler, or null if it isn't. */
export async function readEnactmentTask(
  api: ApiPromise,
  index: number,
): Promise<TaskAddress | null> {
  const lookup = api.query.scheduler?.lookup
  if (!lookup) throw new Error("Chain does not expose scheduler.lookup")
  return decodeTaskAddress(await lookup(enactmentTaskName(index)))
}

/** A `treasury.SpendApproved` the enacted call emitted. */
export type SpendApproved = {
  proposalIndex: number
  amount: bigint
  /** Beneficiary public key, hex. */
  beneficiary: `0x${string}`
}

/** What happened when an enactment task ran. */
export type EnactmentRecord = {
  /** The block the task was scheduled for. */
  block: number
  /**
   * The dispatch result from the scheduler's `Dispatched` event at that
   * block; null when no such event was found there (cancelled, or postponed).
   */
  ok: boolean | null
  /** `treasury.SpendApproved` events emitted while the task ran. */
  spends: SpendApproved[]
}

/** The events `enactmentOutcome` reads, already decoded from their codecs. */
export type SchedulerEvent =
  | { kind: "dispatched"; taskName: string | null; ok: boolean }
  | ({ kind: "spendApproved" } & SpendApproved)
  | { kind: "other" }

/**
 * Find our task's `Dispatched` event in a block's events and the spends the
 * call emitted. Tasks in one block run one after another, each followed by
 * its `Dispatched`, so the spends are those between the previous
 * `Dispatched` and ours.
 */
export function enactmentOutcome(
  events: readonly SchedulerEvent[],
  taskName: string,
): { ok: boolean | null; spends: SpendApproved[] } {
  let pending: SpendApproved[] = []
  const name = taskName.toLowerCase()
  for (const event of events) {
    if (event.kind === "spendApproved") {
      const { proposalIndex, amount, beneficiary } = event
      pending.push({ proposalIndex, amount, beneficiary })
    } else if (event.kind === "dispatched") {
      if (event.taskName?.toLowerCase() === name) return { ok: event.ok, spends: pending }
      pending = []
    }
  }
  return { ok: null, spends: [] }
}

/**
 * Recover how referendum `index`'s enactment ran, from an archive node:
 * the lookup at its approval block gives the block it was scheduled for,
 * and that block's events give the result. Null when the archive has no
 * task at the approval block, or the task's block isn't reached yet.
 */
export async function readEnactmentRecord(
  archive: ApiPromise,
  index: number,
  approvalBlock: number,
): Promise<EnactmentRecord | null> {
  const name = enactmentTaskName(index)
  const atApproval = await archive.at(await archive.rpc.chain.getBlockHash(approvalBlock))
  const task = decodeTaskAddress(await atApproval.query.scheduler.lookup(name))
  if (!task) return null
  const head = await archive.rpc.chain.getHeader()
  if (task.block > toNumber(head.number)) return null
  const atRun = await archive.at(await archive.rpc.chain.getBlockHash(task.block))
  const records = (await atRun.query.system.events()) as unknown as ArrayLike<unknown>
  const events = Array.from(records, toSchedulerEvent)
  return { block: task.block, ...enactmentOutcome(events, name) }
}

type EventRecordLike = {
  event?: { section?: string; method?: string; data?: ArrayLike<unknown> }
}

function toSchedulerEvent(record: unknown): SchedulerEvent {
  const event = (record as EventRecordLike).event
  const data = event?.data
  if (!event || !data) return { kind: "other" }
  if (event.section === "scheduler" && event.method === "Dispatched") {
    // Dispatched { task, id: Option<TaskName>, result: DispatchResult }
    const id = data[1] as { isSome?: boolean; unwrap?: () => { toHex?: () => string } }
    const result = data[2] as { isOk?: boolean }
    return {
      kind: "dispatched",
      taskName: id?.isSome ? (id.unwrap?.().toHex?.() ?? null) : null,
      ok: result?.isOk === true,
    }
  }
  if (event.section === "treasury" && event.method === "SpendApproved") {
    // SpendApproved { proposal_index, amount, beneficiary }
    const beneficiary = data[2] as { toU8a?: () => Uint8Array }
    return {
      kind: "spendApproved",
      proposalIndex: toNumber(data[0]),
      amount: toBigInt(data[1]),
      beneficiary: beneficiary?.toU8a ? u8aToHex(beneficiary.toU8a()) : "0x",
    }
  }
  return { kind: "other" }
}

function toNumber(x: unknown): number {
  if (x == null) return 0
  const v = x as { toNumber?: () => number; toBigInt?: () => bigint }
  if (typeof v.toNumber === "function") return v.toNumber()
  if (typeof v.toBigInt === "function") return Number(v.toBigInt())
  return Number(x)
}

function toBigInt(x: unknown): bigint {
  if (x == null) return 0n
  const v = x as { toBigInt?: () => bigint; toString: () => string }
  if (typeof v.toBigInt === "function") return v.toBigInt()
  return BigInt(v.toString())
}

/**
 * Decode the referenda.referendumInfoFor enum into our normalized Referendum.
 *
 * The on-chain enum is:
 *   ReferendumInfo<Ongoing | Approved | Rejected | Cancelled | TimedOut | Killed>
 * with Option wrapping at the storage layer. We handle both the unwrapped
 * variant and the Option wrapper.
 */

import type { Codec, IOption } from "@polkadot/types/types"
import type {
  Deposit,
  KilledStatus,
  OngoingStatus,
  Referendum,
  ReferendumStatus,
  Tally,
  TerminalStatus,
} from "./types"

type AnyCodec = Codec | unknown

/**
 * Decode an api.query.referenda.referendumInfoFor(index) result.
 * Returns null when the storage entry is None (deleted / never existed).
 */
export function decodeReferendumInfo(index: number, raw: AnyCodec): Referendum | null {
  // Storage returns Option<ReferendumInfo>. Some chains decorate it differently;
  // accept both wrapped and unwrapped inputs.
  const opt = raw as IOption<Codec> & Codec
  let info: AnyCodec = raw
  if (typeof opt.isSome === "boolean") {
    if (!opt.isSome) return null
    info = opt.unwrap()
  }

  const status = decodeStatus(info)
  return {
    index,
    status,
    trackId: status.type === "Ongoing" ? status.trackId : null,
    tally: status.type === "Ongoing" ? status.tally : null,
  }
}

/** Decode a ReferendumInfo enum into the normalized status union. */
export function decodeStatus(raw: AnyCodec): ReferendumStatus {
  const r = raw as Record<string, unknown>

  if (r.isOngoing) return decodeOngoing(r.asOngoing)
  if (r.isKilled) return decodeKilled(r.asKilled)
  if (r.isApproved) return decodeTerminal("Approved", r.asApproved)
  if (r.isRejected) return decodeTerminal("Rejected", r.asRejected)
  if (r.isCancelled) return decodeTerminal("Cancelled", r.asCancelled)
  if (r.isTimedOut) return decodeTerminal("TimedOut", r.asTimedOut)

  throw new Error(`Unknown referendum status variant: ${String(raw)}`)
}

function decodeOngoing(raw: unknown): OngoingStatus {
  const s = raw as Record<string, unknown>

  const proposal = decodeProposal(s.proposal)
  const enactment = decodeEnactment(s.enactment)
  const tally = decodeTally(s.tally)
  const deciding = decodeDeciding(s.deciding)
  const decisionDeposit = decodeOptionalDeposit(s.decisionDeposit)
  const submissionDeposit = decodeDeposit(s.submissionDeposit)
  const alarm = decodeAlarm(s.alarm)

  return {
    type: "Ongoing",
    trackId: toNumber(s.track),
    origin: s.origin,
    proposal,
    enactment,
    submitted: toNumber(s.submitted),
    submissionDeposit,
    decisionDeposit,
    deciding,
    tally,
    inQueue: Boolean((s.inQueue as { isTrue?: boolean; valueOf?: () => boolean })?.valueOf?.()),
    alarm,
  }
}

function decodeKilled(raw: unknown): KilledStatus {
  // Killed is a tuple-variant containing just the block number.
  // polkadot-api may decode it as a tuple or as a single value.
  const block =
    raw && typeof raw === "object" && "0" in (raw as object)
      ? toNumber((raw as Record<string, unknown>)[0])
      : toNumber(raw)
  return { type: "Killed", at: block }
}

function decodeTerminal(
  type: TerminalStatus["type"],
  raw: unknown,
): TerminalStatus {
  // Variant payload is a tuple: (block, Option<Deposit>, Option<Deposit>)
  const t = raw as [unknown, unknown, unknown] | Record<string, unknown>
  let at: unknown
  let sub: unknown
  let dec: unknown
  if (Array.isArray(t)) {
    ;[at, sub, dec] = t
  } else {
    // Some decorations expose .toTuple() - fall back to property access.
    const arr =
      typeof (t as { toJSON?: () => unknown[] }).toJSON === "function"
        ? ((t as { toJSON: () => unknown[] }).toJSON() as unknown[])
        : Object.values(t as Record<string, unknown>)
    ;[at, sub, dec] = arr
  }
  return {
    type,
    at: toNumber(at),
    submissionDeposit: decodeOptionalDeposit(sub),
    decisionDeposit: decodeOptionalDeposit(dec),
  }
}

function decodeProposal(raw: unknown): OngoingStatus["proposal"] {
  const p = raw as Record<string, unknown>
  if (p.isLookup) {
    // IMPORTANT: read the Lookup variant via toJSON() rather than direct
    // property access. On Enjin's runtime, accessing `asLookup.hash`
    // returns a polkadot.js-internal value (the blake2_256 of the
    // encoded `{hash, len}` tuple) instead of the named struct field.
    // toJSON() correctly surfaces the runtime-defined fields.
    const inner = p.asLookup as { toJSON: () => { hash?: string; len?: number } }
    const json = inner.toJSON()
    return {
      hash: (json.hash ?? "0x") as `0x${string}`,
      len: typeof json.len === "number" ? json.len : Number(json.len ?? 0),
    }
  }
  if (p.isLegacy) {
    const inner = p.asLegacy as { toJSON: () => { hash?: string } }
    const json = inner.toJSON()
    return {
      hash: (json.hash ?? "0x") as `0x${string}`,
      len: 0,
    }
  }
  if (p.isInline) {
    // `asInline` is a BoundedVec<u8> - plain `.toU8a()` prepends its compact
    // length, which `createType("Call", …)` would then read as the pallet
    // index. `isBare = true` yields just the call bytes.
    const bytes = (p.asInline as { toU8a: (isBare?: boolean) => Uint8Array }).toU8a(true)
    return { type: "Inline", bytes }
  }
  throw new Error(`Unknown proposal variant: ${String(raw)}`)
}

function decodeEnactment(raw: unknown): OngoingStatus["enactment"] {
  const e = raw as Record<string, unknown>
  if (e.isAt) return { type: "At", block: toNumber(e.asAt) }
  if (e.isAfter) return { type: "After", block: toNumber(e.asAfter) }
  throw new Error(`Unknown enactment variant: ${String(raw)}`)
}

function decodeTally(raw: unknown): Tally {
  const t = raw as Record<string, Codec>
  return {
    ayes: toBigInt(t.ayes),
    nays: toBigInt(t.nays),
    support: toBigInt(t.support),
  }
}

function decodeDeposit(raw: unknown): Deposit {
  const d = raw as Record<string, Codec>
  return {
    who: d.who.toString(),
    amount: toBigInt(d.amount),
  }
}

function decodeOptionalDeposit(raw: unknown): Deposit | null {
  if (raw == null) return null
  const opt = raw as IOption<Codec> & Codec
  if (typeof opt.isSome === "boolean") {
    return opt.isSome ? decodeDeposit(opt.unwrap()) : null
  }
  // Already an unwrapped Deposit-shaped object.
  if (typeof raw === "object" && "who" in (raw as object) && "amount" in (raw as object)) {
    return decodeDeposit(raw)
  }
  return null
}

function decodeDeciding(raw: unknown): OngoingStatus["deciding"] {
  if (raw == null) return null
  const opt = raw as IOption<Codec> & Codec
  let inner: Record<string, Codec>
  if (typeof opt.isSome === "boolean") {
    if (!opt.isSome) return null
    inner = opt.unwrap() as unknown as Record<string, Codec>
  } else {
    inner = raw as Record<string, Codec>
  }
  const confirmingOpt = inner.confirming as unknown as IOption<Codec>
  return {
    since: toNumber(inner.since),
    confirming: confirmingOpt?.isSome ? toNumber(confirmingOpt.unwrap()) : null,
  }
}

function decodeAlarm(raw: unknown): OngoingStatus["alarm"] {
  if (raw == null) return null
  const opt = raw as IOption<Codec> & Codec
  if (typeof opt.isSome === "boolean" && !opt.isSome) return null
  const unwrapped = typeof opt.isSome === "boolean" ? opt.unwrap() : raw
  // The alarm shape is (Moment, Tuple). Take just the block.
  const arr = unwrapped as unknown
  const when = Array.isArray(arr) ? toNumber(arr[0]) : toNumber(arr)
  return { when }
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

/**
 * Decode the referenda pallet's track table from chain runtime constants.
 *
 * Tracks change only on runtime upgrade (spec 1080, for one, changes
 * decision deposits, support floors and maxDeciding), so the decoded table
 * is cached per ApiPromise AND spec version: polkadot.js re-decorates
 * `api.consts` in place on an upgrade, and the next read after it decodes
 * the new table.
 */

import type { ApiPromise } from "@polkadot/api"
import type { Codec } from "@polkadot/types/types"
import type { GovernanceCurve, Track } from "./types"

const trackCache = new WeakMap<ApiPromise, { specVersion: number; tracks: Track[] }>()

/** Read api.consts.referenda.tracks and decode into the normalized Track[]. */
export function getTracks(api: ApiPromise): Track[] {
  const specVersion = api.runtimeVersion.specVersion.toNumber()
  const cached = trackCache.get(api)
  if (cached && cached.specVersion === specVersion) return cached.tracks

  const raw = api.consts.referenda?.tracks
  if (!raw) {
    throw new Error("Chain does not expose api.consts.referenda.tracks")
  }

  const tracks = decodeTracks(raw)
  trackCache.set(api, { specVersion, tracks })
  return tracks
}

/** Lookup helper: returns the track with `id`, or null. */
export function findTrack(tracks: readonly Track[], id: number): Track | null {
  return tracks.find((t) => t.id === id) ?? null
}

/**
 * Lookup helper: returns the track whose name matches, ignoring both
 * case AND separator style. The chain's runtime serialises track names
 * in snake_case (`small_tipper`) but our code paths often carry the
 * Origins variant name in PascalCase (`SmallTipper`). Normalise both
 * to lowercase-no-separators before comparing so a PascalCase lookup
 * still hits the snake_case row.
 */
export function findTrackByName(tracks: readonly Track[], name: string): Track | null {
  const key = normaliseTrackName(name)
  return tracks.find((t) => normaliseTrackName(t.name) === key) ?? null
}

function normaliseTrackName(name: string): string {
  // Strip ASCII control bytes (the runtime pads names with NULs),
  // underscores, dashes and whitespace, then lowercase. This makes
  // "SmallTipper" match "small_tipper\u0000\u0000…" without callers
  // having to know about the padding.
  return name.replace(/[\u0000-\u001f\u007f_\s-]+/g, "").toLowerCase()
}

/**
 * Public alias of the internal normaliser - callers comparing arbitrary
 * track names (e.g. "is this one of the treasury tracks?") should use
 * this so PascalCase vs snake_case differences don't bite.
 */
export const canonicalTrackName = normaliseTrackName

/**
 * Decode the raw `Vec<(TrackId, TrackInfo)>` from api.consts.referenda.tracks.
 * Pulled out as a pure function so we can feed it mocked Codec-like objects
 * in tests.
 */
export function decodeTracks(raw: Codec | unknown): Track[] {
  const entries = raw as ReadonlyArray<[Codec, Codec]>
  return entries.map(([idCodec, info]) => decodeTrack(idCodec, info))
}

function decodeTrack(idCodec: Codec, info: Codec): Track {
  const id = toNumber(idCodec)
  const i = info as unknown as Record<string, Codec>

  // The chain stores track names as fixed-width byte strings padded
  // with NUL bytes to a 21-byte slot. Trim those trailing nulls (and
  // any other non-printable control chars) so downstream string
  // comparisons and display don't have to worry about them.
  const rawName = (i.name as unknown as { toString(): string }).toString()
  const cleanName = rawName.replace(/[\u0000-\u001f\u007f]+/g, "").trim()

  return {
    id,
    name: cleanName,
    maxDeciding: toNumber(i.maxDeciding),
    decisionDeposit: toBigInt(i.decisionDeposit),
    preparePeriod: toNumber(i.preparePeriod),
    decisionPeriod: toNumber(i.decisionPeriod),
    confirmPeriod: toNumber(i.confirmPeriod),
    minEnactmentPeriod: toNumber(i.minEnactmentPeriod),
    minApproval: decodeCurve(i.minApproval),
    minSupport: decodeCurve(i.minSupport),
  }
}

export function decodeCurve(raw: Codec | unknown): GovernanceCurve {
  const c = raw as unknown as Record<string, unknown>

  if (c.isLinearDecreasing) {
    const inner = c.asLinearDecreasing as Record<string, Codec>
    return {
      type: "LinearDecreasing",
      length: toNumber(inner.length),
      floor: toNumber(inner.floor),
      ceil: toNumber(inner.ceil),
    }
  }
  if (c.isSteppedDecreasing) {
    const inner = c.asSteppedDecreasing as Record<string, Codec>
    return {
      type: "SteppedDecreasing",
      begin: toNumber(inner.begin),
      end: toNumber(inner.end),
      step: toNumber(inner.step),
      period: toNumber(inner.period),
    }
  }
  if (c.isReciprocal) {
    const inner = c.asReciprocal as Record<string, Codec>
    return {
      type: "Reciprocal",
      factor: toBigInt(inner.factor),
      xOffset: toBigInt(inner.xOffset),
      yOffset: toBigInt(inner.yOffset),
    }
  }
  throw new Error(`Unknown curve variant: ${String(raw)}`)
}

function toNumber(x: Codec | unknown): number {
  if (x == null) return 0
  const v = x as { toNumber?: () => number; toBigInt?: () => bigint }
  if (typeof v.toNumber === "function") return v.toNumber()
  if (typeof v.toBigInt === "function") return Number(v.toBigInt())
  return Number(x)
}

function toBigInt(x: Codec | unknown): bigint {
  if (x == null) return 0n
  const v = x as { toBigInt?: () => bigint; toString: () => string }
  if (typeof v.toBigInt === "function") return v.toBigInt()
  return BigInt(v.toString())
}

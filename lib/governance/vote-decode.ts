/**
 * Decode Enjin / Substrate vote primitives.
 *
 * `vote` byte (in `voteManager.vote` extrinsics, standard variant):
 *   bit 7 (0x80) → aye flag (1 = Aye, 0 = Nay)
 *   bits 0-2     → conviction enum (0=None … 6=Locked6x)
 *
 * `currency` arg (Enjin-specific extension to AccountVote):
 *   { Enj: null }                - liquid ENJ
 *   { SEnj: <poolId> }           - staked ENJ from pool #poolId
 *
 * Subscan tends to return `vote` either as a raw u8 ("130"), a string
 * label ("Aye" / "Nay"), or an object like { aye: true, conviction: 2 }.
 * We accept all three shapes.
 */

import {
  CONVICTIONS,
  CONVICTION_LOCK_PERIODS,
  CONVICTION_MULTIPLIER,
  type Conviction,
} from "@/lib/governance/types"

type DecodedVote = {
  aye: boolean
  conviction: Conviction
  /** 1, 2, 3, 4, 5, 6, or 0.1 for None. */
  multiplier: number
  /** Track-lock periods applied after the vote (0 for None). */
  lockPeriods: number
}

type VoteCurrencyDecoded =
  | { kind: "Enj" }
  | { kind: "SEnj"; poolId: number }
  | { kind: "Unknown" }

export function convictionFromByte(byte: number): Conviction {
  // Conviction lives in bits 0-2 (the aye flag is bit 7).
  const idx = byte & 0x07
  return CONVICTIONS[Math.min(idx, CONVICTIONS.length - 1)] ?? "None"
}

export function decodeVoteByte(byte: number): DecodedVote {
  const aye = (byte & 0x80) !== 0
  const conviction = convictionFromByte(byte)
  return {
    aye,
    conviction,
    multiplier: CONVICTION_MULTIPLIER[conviction],
    lockPeriods: CONVICTION_LOCK_PERIODS[conviction],
  }
}

/**
 * Accept the various shapes Subscan returns for a vote and normalise.
 * Returns null if we genuinely can't tell whether it was aye or nay.
 */
export function decodeVote(raw: unknown): DecodedVote | null {
  if (raw == null) return null

  // Plain numeric byte: e.g. 130 (0x82) → Aye + Locked2x.
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return decodeVoteByte(raw)
  }
  if (typeof raw === "string") {
    const n = Number(raw)
    if (Number.isFinite(n) && /^\d+$/.test(raw)) return decodeVoteByte(n)
    // "Aye" / "Nay" - Subscan v2 sometimes returns the label only,
    // with conviction broken out separately. Caller layers on the
    // separate conviction byte if needed.
    if (/^aye$/i.test(raw)) {
      return {
        aye: true,
        conviction: "Locked1x",
        multiplier: 1,
        lockPeriods: 1,
      }
    }
    if (/^nay$/i.test(raw)) {
      return {
        aye: false,
        conviction: "Locked1x",
        multiplier: 1,
        lockPeriods: 1,
      }
    }
    return null
  }
  if (typeof raw === "object") {
    const v = raw as Record<string, unknown>
    if (typeof v.aye === "boolean" && typeof v.conviction === "number") {
      const conviction =
        CONVICTIONS[Math.min(v.conviction, CONVICTIONS.length - 1)] ?? "None"
      return {
        aye: v.aye,
        conviction,
        multiplier: CONVICTION_MULTIPLIER[conviction],
        lockPeriods: CONVICTION_LOCK_PERIODS[conviction],
      }
    }
    // { Standard: { vote: {aye, conviction}, balance } }
    const std = v.Standard ?? v.standard
    if (std && typeof std === "object") {
      const inner = (std as Record<string, unknown>).vote
      if (inner != null) return decodeVote(inner)
    }
  }
  return null
}

export function decodeCurrency(raw: unknown): VoteCurrencyDecoded {
  if (raw == null) return { kind: "Unknown" }
  if (typeof raw === "string") {
    if (/^enj$/i.test(raw)) return { kind: "Enj" }
    if (/^senj$/i.test(raw)) return { kind: "SEnj", poolId: 0 }
    return { kind: "Unknown" }
  }
  if (typeof raw === "object") {
    const v = raw as Record<string, unknown>
    // Accept every common casing of the variant name. polkadot.js's
    // `.toJSON()` camelCases the first letter (`SEnj` → `sEnj`,
    // `Enj` → `enj`); Subscan emits the runtime's PascalCase form
    // (`SEnj`, `Enj`); and we also tolerate fully lowercased forms.
    if ("Enj" in v || "enj" in v) return { kind: "Enj" }
    const pool = v.SEnj ?? v.sEnj ?? v.senj
    if (pool != null) {
      // Two shapes: the chain's struct form `{ tokenId: <n> }` (what
      // the runtime emits and what we must encode for vote()), and
      // Subscan's flattened `<n>` (what its JSON dumps show).
      // Handle both.
      let raw: unknown = pool
      if (typeof pool === "object" && pool !== null) {
        const inner = pool as Record<string, unknown>
        raw = inner.tokenId ?? inner.token_id ?? pool
      }
      const n = typeof raw === "number" ? raw : Number(raw)
      return { kind: "SEnj", poolId: Number.isFinite(n) ? n : 0 }
    }
  }
  return { kind: "Unknown" }
}

/** Display label for a currency: "ENJ" / "sENJ #3" / "ENJ / sENJ". */
export function formatCurrencyLabel(currency: VoteCurrencyDecoded): string {
  switch (currency.kind) {
    case "Enj":
      return "ENJ"
    case "SEnj":
      return `sENJ · pool #${currency.poolId}`
    default:
      return "ENJ"
  }
}

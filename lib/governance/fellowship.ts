/**
 * The Enjin Fellowship: a ranked collective (`fellowshipCollective`) with
 * its own referenda (`fellowshipReferenda`). Its referenda share the public
 * pallet's storage shape and are read through the same readers with
 * `pallet = "fellowshipReferenda"`; this module adds what is its own:
 * members and ranks, the rank-weighted tally and the vote.
 *
 * Rules read from the runtime (Enjin and Canary Relaychain, Oct 2026):
 *   - track N is open to members of rank N and above (0 Candidates … 9
 *     Grand Masters);
 *   - a member of rank r counts (e + 1)(e + 2) / 2 on a track of minimum
 *     rank m, e = r - m (Canary F#0: a rank IX vote counted 28 on track 3);
 *   - support is the share of members of rank m or above who voted aye,
 *     one each (`bareAyes`); approval is ayes / (ayes + nays) by weight;
 *   - a vote is Aye or Nay: no amount, no conviction, no lock.
 */

import type { ApiPromise } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { Codec } from "@polkadot/types/types"
import { decodeReferendumInfo } from "./status"
import { decodeTracks } from "./tracks"
import type { Referendum, Track } from "./types"

export const FELLOWSHIP_PALLET = "fellowshipReferenda" as const

/** Rank names, as the runtime names the track each rank opens. */
const RANK_NAMES = [
  "Candidate",
  "Member",
  "Proficient",
  "Fellow",
  "Senior Fellow",
  "Expert",
  "Senior Expert",
  "Master",
  "Senior Master",
  "Grand Master",
] as const

const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"] as const

export const MAX_RANK = RANK_NAMES.length - 1

export function rankName(rank: number): string {
  return RANK_NAMES[rank] ?? `Rank ${rank}`
}

/** "VII", the short form the badges use; "0" for candidates. */
export function rankNumeral(rank: number): string {
  return ROMAN[rank] ?? String(rank)
}

export type FellowshipMember = {
  /** SS58 as the node returns it. */
  address: string
  rank: number
}

export type RankedTally = {
  /** Members who voted aye, one each: what support counts. */
  bareAyes: number
  /** Rank-weighted aye votes. */
  ayes: number
  /** Rank-weighted nay votes. */
  nays: number
}

export type FellowshipVote = { aye: boolean; weight: number }

/** Whether the runtime runs a Fellowship at all. */
export function hasFellowship(api: ApiPromise | null | undefined): boolean {
  return !!api?.query.fellowshipCollective?.members && !!api.query.fellowshipReferenda
}

/** The minimum rank of a fellowship track: on Enjin, its id. */
export function trackMinRank(trackId: number): number {
  return trackId
}

/** What a member of `rank` counts on a track of minimum rank `minRank`. */
export function voteWeight(rank: number, minRank: number): number {
  if (rank < minRank) return 0
  const excess = rank - minRank
  return ((excess + 1) * (excess + 2)) / 2
}

/** Members of `minRank` or above: the ones who may vote on that track. */
export function eligibleMembers(
  members: readonly FellowshipMember[],
  minRank: number,
): FellowshipMember[] {
  return members.filter((m) => m.rank >= minRank)
}

/** Track names come lower case ("senior fellows"); title-case them. */
export function fellowshipTrackLabel(track: Pick<Track, "name"> | null | undefined, trackId: number): string {
  const name = track?.name?.trim()
  if (!name) return `Track ${trackId}`
  return name.replace(/(^|[\s_])([a-z])/g, (_, sep: string, c: string) => `${sep === "_" ? " " : sep}${c.toUpperCase()}`)
}

/** "Fellows · rank III+" for a track card or chip. */
export function fellowshipTrackCaption(track: Pick<Track, "name"> | null | undefined, trackId: number): string {
  const min = trackMinRank(trackId)
  return `${fellowshipTrackLabel(track, trackId)} · rank ${rankNumeral(min)}+`
}

/** Every member with their rank, highest rank first. */
export async function listMembers(api: ApiPromise): Promise<FellowshipMember[]> {
  const entries = await api.query.fellowshipCollective!.members!.entries()
  const members = entries.map(([key, value]) => {
    const record = (value as unknown as { unwrapOr?: (d: null) => unknown }).unwrapOr
      ? (value as unknown as { unwrapOr: (d: null) => Codec | null }).unwrapOr(null)
      : value
    const json = (record as Codec | null)?.toJSON() as { rank?: number } | null
    return {
      address: (key.args[0] as Codec).toString(),
      rank: Number(json?.rank ?? 0),
    }
  })
  members.sort((a, b) => b.rank - a.rank || a.address.localeCompare(b.address))
  return members
}

/** The fellowship track table, decoded like the public one. */
export function getFellowshipTracks(api: ApiPromise): Track[] {
  const raw = api.consts.fellowshipReferenda?.tracks
  if (!raw) throw new Error("Chain does not expose fellowshipReferenda.tracks")
  return decodeTracks(raw)
}

/**
 * The ranked tally of an ongoing fellowship referendum, from its raw
 * storage value. Null for a decided one (the runtime drops the tally).
 */
export function decodeRankedTally(info: unknown): RankedTally | null {
  const opt = info as { isSome?: boolean; unwrap?: () => unknown }
  const inner = typeof opt?.isSome === "boolean" ? (opt.isSome ? opt.unwrap!() : null) : info
  const json = (inner as Codec | null)?.toJSON?.() as
    | { ongoing?: { tally?: { bareAyes?: number; ayes?: number; nays?: number } } }
    | null
    | undefined
  const tally = json?.ongoing?.tally
  if (!tally) return null
  return {
    bareAyes: Number(tally.bareAyes ?? 0),
    ayes: Number(tally.ayes ?? 0),
    nays: Number(tally.nays ?? 0),
  }
}

/** Raw `VoteRecord` ({ aye: n } | { nay: n }) to our shape. */
export function decodeFellowshipVote(raw: unknown): FellowshipVote | null {
  if (raw == null) return null
  const json = raw as { aye?: number | string; nay?: number | string; Aye?: number; Nay?: number }
  if (json.aye != null || json.Aye != null) return { aye: true, weight: Number(json.aye ?? json.Aye) }
  if (json.nay != null || json.Nay != null) return { aye: false, weight: Number(json.nay ?? json.Nay) }
  return null
}

/** Every vote cast on fellowship referendum `poll`, heaviest first. */
export async function listFellowshipVotes(
  api: ApiPromise,
  poll: number,
): Promise<(FellowshipVote & { voter: string })[]> {
  const entries = await api.query.fellowshipCollective!.voting!.entries(poll)
  const votes: (FellowshipVote & { voter: string })[] = []
  for (const [key, value] of entries) {
    const opt = value as unknown as { isSome?: boolean; unwrap?: () => Codec }
    const record = typeof opt.isSome === "boolean" ? (opt.isSome ? opt.unwrap!() : null) : (value as Codec)
    const vote = decodeFellowshipVote(record?.toJSON())
    if (!vote) continue
    votes.push({ voter: (key.args[1] as Codec).toString(), ...vote })
  }
  votes.sort((a, b) => b.weight - a.weight || a.voter.localeCompare(b.voter))
  return votes
}

/** `fellowshipCollective.vote(poll, aye)`. Unsigned. */
export function buildFellowshipVote(
  api: ApiPromise,
  poll: number,
  aye: boolean,
): SubmittableExtrinsic<"promise"> {
  return api.tx.fellowshipCollective!.vote!(poll, aye) as SubmittableExtrinsic<"promise">
}

/**
 * Approval and support of a ranked tally, 0..1, against the members who
 * may vote on the track.
 */
export function rankedShares(
  tally: RankedTally,
  eligibleCount: number,
): { approval: number | null; support: number } {
  const total = tally.ayes + tally.nays
  return {
    approval: total > 0 ? tally.ayes / total : null,
    support: eligibleCount > 0 ? tally.bareAyes / eligibleCount : 0,
  }
}

export type FellowshipReferendum = Referendum & {
  /** The rank-weighted tally while ongoing; null once decided. */
  rankedTally: RankedTally | null
}

/** Every fellowship referendum, newest first, with its ranked tally. */
export async function listFellowshipReferenda(api: ApiPromise): Promise<FellowshipReferendum[]> {
  const entries = await api.query.fellowshipReferenda!.referendumInfoFor!.entries()
  const out: FellowshipReferendum[] = []
  for (const [key, info] of entries) {
    const index = (key.args[0] as unknown as { toNumber: () => number }).toNumber()
    const ref = decodeReferendumInfo(index, info)
    if (!ref) continue
    out.push({ ...ref, rankedTally: decodeRankedTally(info) })
  }
  out.sort((a, b) => b.index - a.index)
  return out
}

/** One fellowship referendum with its ranked tally; null if there is none. */
export async function getFellowshipReferendum(
  api: ApiPromise,
  index: number,
): Promise<FellowshipReferendum | null> {
  const info = await api.query.fellowshipReferenda!.referendumInfoFor!(index)
  const ref = decodeReferendumInfo(index, info)
  return ref ? { ...ref, rankedTally: decodeRankedTally(info) } : null
}

/** The member's vote on `poll`, or null. */
export async function getMyFellowshipVote(
  api: ApiPromise,
  poll: number,
  who: string,
): Promise<FellowshipVote | null> {
  const raw = await api.query.fellowshipCollective!.voting!(poll, who)
  const opt = raw as unknown as { isSome?: boolean; unwrap?: () => Codec }
  const record = typeof opt.isSome === "boolean" ? (opt.isSome ? opt.unwrap!() : null) : (raw as Codec)
  return decodeFellowshipVote(record?.toJSON())
}

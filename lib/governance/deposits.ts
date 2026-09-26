/**
 * Discover the governance deposits an address has tied up on chain, so the UI
 * can show them and offer one-click reclaim. Two sources:
 *
 *  - Referendum deposits - the submission + decision deposits on each
 *    `referenda` row, refundable once the referendum is terminal
 *    (Approved / Rejected / TimedOut / Cancelled; a Killed referendum slashes
 *    them, so none remain).
 *  - Preimage deposits - the per-byte deposit held for a noted preimage,
 *    which the runtime lets its depositor reclaim via `unnotePreimage` while
 *    the preimage is Unrequested.
 *
 * Unrequested doesn't mean unused. An Ongoing referendum's proposal is
 * Unrequested (on Enjin mainnet #12-#14 all are - `referenda.submit`
 * doesn't request its Lookup), and unnoting it leaves the referendum
 * nothing to enact, so those are held back as in use. A proposal's EGOV1
 * envelope stays Unrequested too - `referenda.setMetadata` binds its hash
 * without requesting it - and unnoting it breaks `MetadataOf` → preimage →
 * `EGOV1:{u,h}`, the proposal's on-chain record; those deposits carry
 * `proposalRecord` and the UI keeps them out of the routine reclaim flow.
 *
 * Reserved balance ≠ conviction lock: unlocking a vote never frees these.
 */

import type { ApiPromise } from "@polkadot/api"
import { stringToU8a } from "@polkadot/util"
import { samePublicKey } from "@/lib/chain/ss58"
import { REMARK_MAGIC } from "./proposal-metadata"
import { listReferenda } from "./referenda"
import type { Referendum } from "./types"

export type ReferendumDeposit = {
  index: number
  kind: "submission" | "decision"
  amount: bigint
  /** Refundable now (the referendum has concluded). */
  refundable: boolean
}

export type PreimageDeposit = {
  hash: `0x${string}`
  len: number | null
  amount: bigint
  /**
   * Reclaimable now: Unrequested, and not the proposal of an Ongoing
   * referendum. Check `proposalRecord` before offering it.
   */
  unnotable: boolean
  /**
   * Set when the preimage is a proposal's on-chain record - an EGOV1
   * envelope, or whatever a referendum's `MetadataOf` points at. Unnoting
   * it is allowed but leaves that record unreadable. See markProposalRecords.
   */
  proposalRecord?: ProposalRecordRef
}

export type ProposalRecordRef = {
  /** Referendum whose `MetadataOf` binds this preimage; null when none does. */
  referendumIndex: number | null
}

/**
 * Pure: pull `address`'s submission/decision deposits out of decoded referenda.
 * A Killed referendum exposes no deposits (they were slashed). Ongoing
 * referenda hold the deposits but they're not refundable until conclusion.
 */
export function extractReferendumDeposits(
  refs: readonly Referendum[],
  address: string,
): ReferendumDeposit[] {
  const out: ReferendumDeposit[] = []
  for (const r of refs) {
    const s = r.status
    if (s.type === "Killed") continue
    const refundable = s.type !== "Ongoing"
    const sub = s.submissionDeposit
    if (sub && samePublicKey(sub.who, address)) {
      out.push({ index: r.index, kind: "submission", amount: sub.amount, refundable })
    }
    const dec = s.decisionDeposit
    if (dec && samePublicKey(dec.who, address)) {
      out.push({ index: r.index, kind: "decision", amount: dec.amount, refundable })
    }
  }
  return out
}

/** Scan every referendum and return the deposits placed by `address`. */
export async function getReferendumDepositsFor(
  api: ApiPromise,
  address: string,
): Promise<ReferendumDeposit[]> {
  const refs = await listReferenda(api)
  return extractReferendumDeposits(refs, address)
}

type RequestStatusJson = {
  unrequested?: { ticket?: [string, string | number]; deposit?: [string, string | number]; len?: number }
  requested?: {
    maybeTicket?: [string, string | number] | null
    deposit?: [string, string | number] | null
    maybeLen?: number | null
  }
}

function toBig(v: string | number): bigint {
  return typeof v === "number" ? BigInt(v) : BigInt(v)
}

/**
 * Pure: extract a preimage deposit for `address` from one requestStatusFor
 * row's JSON. Unrequested rows carry a `ticket`/`deposit` tuple [who, amount]
 * and are unnotable; Requested rows are held by a referendum (not unnotable).
 */
export function parsePreimageDeposit(
  json: RequestStatusJson,
  hash: `0x${string}`,
  address: string,
): PreimageDeposit | null {
  const u = json.unrequested
  if (u) {
    const dep = u.ticket ?? u.deposit
    if (Array.isArray(dep) && samePublicKey(String(dep[0]), address)) {
      return { hash, len: u.len ?? null, amount: toBig(dep[1]), unnotable: true }
    }
    return null
  }
  const req = json.requested
  if (req) {
    const dep = req.maybeTicket ?? req.deposit
    if (Array.isArray(dep) && samePublicKey(String(dep[0]), address)) {
      return { hash, len: req.maybeLen ?? null, amount: toBig(dep[1]), unnotable: false }
    }
  }
  return null
}

const ENVELOPE_MAGIC = stringToU8a(REMARK_MAGIC)

/**
 * EGOV1 envelopes are a URL plus a sha256 - under 200 bytes in practice.
 * Larger preimages (proposal calls, runtime code) aren't downloaded just to
 * check their first six bytes.
 */
const MAX_ENVELOPE_BYTES = 4096

/** Pure: whether `bytes` start with the EGOV1 envelope magic (`EGOV1:`). */
export function isEnvelopeBytes(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < ENVELOPE_MAGIC.length) return false
  return ENVELOPE_MAGIC.every((b, i) => bytes[i] === b)
}

/**
 * Pure: flag the deposits that hold a proposal's on-chain record. A hash in
 * `metadataOf` (lower-case hash → referendum index, from
 * `referenda.metadataOf`) is bound to that referendum whatever its bytes; a
 * hash in `envelopeHashes` (lower-case) holds EGOV1 bytes that no
 * referendum points at. Other deposits are returned unchanged.
 */
export function markProposalRecords(
  deposits: readonly PreimageDeposit[],
  metadataOf: ReadonlyMap<string, number>,
  envelopeHashes: ReadonlySet<string>,
): PreimageDeposit[] {
  return deposits.map((d) => {
    const key = d.hash.toLowerCase()
    const referendumIndex = metadataOf.get(key)
    if (referendumIndex != null) return { ...d, proposalRecord: { referendumIndex } }
    if (envelopeHashes.has(key)) return { ...d, proposalRecord: { referendumIndex: null } }
    return d
  })
}

/**
 * Pure: hold back the deposits whose preimage is an Ongoing referendum's
 * proposal (`ongoingProposals`: lower-case Lookup hashes). The runtime would
 * let the depositor unnote it, but the referendum would then have nothing
 * to enact.
 */
export function holdOngoingProposals(
  deposits: readonly PreimageDeposit[],
  ongoingProposals: ReadonlySet<string>,
): PreimageDeposit[] {
  return deposits.map((d) =>
    d.unnotable && ongoingProposals.has(d.hash.toLowerCase()) ? { ...d, unnotable: false } : d,
  )
}

/** Lower-case hashes of the Lookup proposals of the Ongoing referenda in `refs`. */
function ongoingProposalHashes(refs: readonly Referendum[]): Set<string> {
  const out = new Set<string>()
  for (const r of refs) {
    if (r.status.type !== "Ongoing") continue
    const proposal = r.status.proposal
    if ("hash" in proposal) out.add(proposal.hash.toLowerCase())
  }
  return out
}

/** `referenda.metadataOf` as lower-case hash → referendum index. */
async function readMetadataHashes(api: ApiPromise): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!api.query.referenda?.metadataOf) return out
  const entries = await api.query.referenda.metadataOf.entries()
  for (const [key, val] of entries) {
    const opt = val as unknown as { isSome: boolean; unwrap: () => { toHex: () => string } }
    if (!opt.isSome) continue
    const index = (key.args[0] as unknown as { toNumber: () => number }).toNumber()
    out.set(opt.unwrap().toHex().toLowerCase(), index)
  }
  return out
}

/** Lower-case hashes of the `deposits` whose preimage bytes start with `EGOV1:`. */
async function readEnvelopeHashes(
  api: ApiPromise,
  deposits: readonly PreimageDeposit[],
): Promise<Set<string>> {
  const out = new Set<string>()
  await Promise.all(
    deposits.map(async (d) => {
      if (d.len == null || d.len > MAX_ENVELOPE_BYTES) return
      const raw = await api.query.preimage.preimageFor([d.hash, d.len])
      const opt = raw as unknown as {
        isSome: boolean
        unwrap: () => { toU8a: (isBare?: boolean) => Uint8Array }
      }
      // isBare: the raw bytes, without the Bytes codec's length prefix.
      if (opt.isSome && isEnvelopeBytes(opt.unwrap().toU8a(true))) {
        out.add(d.hash.toLowerCase())
      }
    }),
  )
  return out
}

/**
 * Scan all noted preimages and return the deposits placed by `address`,
 * with Ongoing referenda's proposals held back (holdOngoingProposals) and
 * proposal records flagged (markProposalRecords). Read errors propagate
 * rather than leaving either unmarked.
 */
export async function getPreimageDepositsFor(
  api: ApiPromise,
  address: string,
): Promise<PreimageDeposit[]> {
  const entries = await api.query.preimage.requestStatusFor.entries()
  const out: PreimageDeposit[] = []
  for (const [key, val] of entries) {
    const json = (val as unknown as { toJSON: () => RequestStatusJson }).toJSON()
    const hash = (key.args[0] as unknown as { toHex: () => `0x${string}` }).toHex()
    const dep = parsePreimageDeposit(json, hash, address)
    if (dep) out.push(dep)
  }
  if (out.length === 0) return out
  const [metadataOf, ongoing] = await Promise.all([
    readMetadataHashes(api),
    listReferenda(api, { status: "Ongoing" }),
  ])
  const unbound = out.filter((d) => !metadataOf.has(d.hash.toLowerCase()))
  const envelopeHashes = await readEnvelopeHashes(api, unbound)
  const held = holdOngoingProposals(out, ongoingProposalHashes(ongoing))
  return markProposalRecords(held, metadataOf, envelopeHashes)
}

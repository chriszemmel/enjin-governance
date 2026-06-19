/**
 * Discover the governance deposits an address has tied up on chain, so the UI
 * can show them and offer one-click reclaim. Two sources:
 *
 *  - Referendum deposits - the submission + decision deposits on each
 *    `referenda` row, refundable once the referendum is terminal
 *    (Approved / Rejected / TimedOut / Cancelled; a Killed referendum slashes
 *    them, so none remain).
 *  - Preimage deposits - the per-byte deposit held for a noted preimage,
 *    reclaimable via `unnotePreimage` while the preimage is Unrequested (not
 *    held by an active referendum's Lookup).
 *
 * Reserved balance ≠ conviction lock: unlocking a vote never frees these.
 */

import type { ApiPromise } from "@polkadot/api"
import { samePublicKey } from "@/lib/chain/ss58"
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
  /** Reclaimable now (Unrequested - not held by a referendum). */
  unnotable: boolean
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

/** Scan all noted preimages and return the deposits placed by `address`. */
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
  return out
}

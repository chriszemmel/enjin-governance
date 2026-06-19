/**
 * Helpers for working with the events / dispatch errors that come back from
 * an extrinsic's signAndSend callback.
 *
 * These are consumed by lib/query/hooks/use-tx.ts; keeping the decoding
 * logic here keeps that hook small and lets us unit-test it separately
 * from the network.
 */

import type { ApiPromise } from "@polkadot/api"
import type { DispatchError, Event, EventRecord } from "@polkadot/types/interfaces"

/**
 * Recognise the family of "the chain pruned the state I'm asking about"
 * errors. These should be treated as soft errors (skip + continue) rather
 * than fatal failures, since they only mean the data is no longer queryable
 * at that block - not that anything is actually wrong.
 */
export function isDiscardedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message
  return (
    message.includes("State already discarded") ||
    message.includes("Unknown block") ||
    message.includes("Unable to retrieve header") ||
    message.includes("Unable to retrieve header and parent from supplied hash")
  )
}

/**
 * Find the first event in a record matching `pallet.method`. Returns null
 * if none matches. Compare event.section/method as strings rather than
 * using `api.events.x.y.is(event)` so we don't need the api instance here.
 */
export function findEvent(
  events: EventRecord[] | readonly EventRecord[],
  pallet: string,
  method: string,
): Event | null {
  for (const record of events) {
    if (record.event.section === pallet && record.event.method === method) {
      return record.event
    }
  }
  return null
}

/** Same as findEvent but returns every match. */
export function findAllEvents(
  events: EventRecord[] | readonly EventRecord[],
  pallet: string,
  method: string,
): Event[] {
  const matches: Event[] = []
  for (const record of events) {
    if (record.event.section === pallet && record.event.method === method) {
      matches.push(record.event)
    }
  }
  return matches
}

/** True iff the extrinsic emitted system.ExtrinsicSuccess. */
export function wasExtrinsicSuccessful(events: EventRecord[] | readonly EventRecord[]): boolean {
  return findEvent(events, "system", "ExtrinsicSuccess") !== null
}

/** True iff the extrinsic emitted system.ExtrinsicFailed. */
export function didExtrinsicFail(events: EventRecord[] | readonly EventRecord[]): boolean {
  return findEvent(events, "system", "ExtrinsicFailed") !== null
}

/**
 * Turn a DispatchError into a human-readable message.
 *
 * For module errors we resolve the on-chain metadata via the api registry,
 * so callers get "balances.InsufficientBalance: ..." rather than an opaque
 * `{ Module: { index: 5, error: 0x02000000 } }` blob.
 */
export function decodeDispatchError(api: ApiPromise, error: DispatchError): string {
  if (error.isModule) {
    try {
      const meta = api.registry.findMetaError(error.asModule)
      const docs = meta.docs.join(" ").trim()
      return `${meta.section}.${meta.name}${docs ? `: ${docs}` : ""}`
    } catch {
      return `Module error: ${error.toString()}`
    }
  }
  if (error.isToken) return `Token error: ${error.asToken.type}`
  if (error.isArithmetic) return `Arithmetic error: ${error.asArithmetic.type}`
  if (error.isTransactional) return `Transactional error: ${error.asTransactional.type}`
  return `Error: ${error.toString()}`
}

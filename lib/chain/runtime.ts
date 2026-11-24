/**
 * Checked access to a runtime's pallets.
 *
 * `api.tx` and `api.query` are records keyed by whatever pallets the
 * connected runtime declares, so `api.tx.referenda.cancel` is only there
 * when the chain has it. These accessors return the call or storage entry,
 * or throw a message that names what is missing - instead of a bare
 * "Cannot read properties of undefined" from deep inside a builder, or a
 * `!` that tells the compiler not to ask.
 */

import type { ApiPromise } from "@polkadot/api"
import type { QueryableStorageEntry, SubmittableExtrinsicFunction } from "@polkadot/api/types"
import type { Codec } from "@polkadot/types/types"

/** `api.tx[pallet][call]`; throws when the runtime has no such call. */
export function txCall(
  api: Pick<ApiPromise, "tx">,
  pallet: string,
  call: string,
): SubmittableExtrinsicFunction<"promise"> {
  const fn = api.tx[pallet]?.[call]
  if (!fn) throw new Error(`Chain does not expose ${pallet}.${call}`)
  return fn
}

/** `api.query[pallet][item]`; throws when the runtime has no such storage item. */
export function queryEntry(
  api: Pick<ApiPromise, "query">,
  pallet: string,
  item: string,
): QueryableStorageEntry<"promise"> {
  const entry = api.query[pallet]?.[item]
  if (!entry) throw new Error(`Chain does not expose ${pallet}.${item}`)
  return entry
}

/** `api.consts[pallet][name]`, or undefined when the runtime has no such constant. */
export function constEntry(
  api: Pick<ApiPromise, "consts">,
  pallet: string,
  name: string,
): Codec | undefined {
  return api.consts[pallet]?.[name]
}

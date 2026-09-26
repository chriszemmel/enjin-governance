/**
 * Curated proposal-call composer.
 *
 * A referendum enacts a single Call. Today the create wizard only ever builds
 * a treasury `spend_local`; this module builds the inner Call for the full set
 * of proposal types a DAO needs - treasury spends, referendum admin
 * (cancel/kill), call whitelisting, runtime upgrades, on-chain remarks - plus
 * a raw escape hatch for pasting any SCALE-encoded call.
 *
 * Each builder returns a `Call` (decoded `.method`), NOT a signed extrinsic.
 * The caller wraps it via preimage/inline + `referenda.submit` under the
 * appropriate track origin (see `suggestedOrigin`). We keep the set curated
 * (rather than a free-form pallet/method explorer) because it is far safer for
 * proposers and matches how Polkassembly et al. present proposal creation.
 */

import type { ApiPromise } from "@polkadot/api"
import type { Call } from "@polkadot/types/interfaces"
import { stringToHex, u8aToHex } from "@polkadot/util"
import { buildSpendLocalCall } from "./treasury"
import {
  buildCancelReferendumCall,
  buildKillReferendumCall,
  buildWhitelistCall,
} from "./referenda"

export type ProposalCallSpec =
  | { kind: "treasurySpend"; amount: bigint; beneficiary: string }
  | { kind: "cancelReferendum"; index: number }
  | { kind: "killReferendum"; index: number }
  | { kind: "whitelistCall"; callHash: `0x${string}` }
  | { kind: "runtimeUpgrade"; codeHex: `0x${string}` }
  | { kind: "remark"; text: string }
  | { kind: "rawCall"; callHex: `0x${string}` }

export type ProposalKind = ProposalCallSpec["kind"]

/**
 * Submission origins offered by the advanced composer, every one verified
 * encodable against enjin v1070's `EnjinRuntimeOriginCaller`. Root is the
 * system origin; the rest are `pallet_custom_origins` tracks. (Treasury spends
 * derive their tier from the amount and don't use this list.)
 */
export const SUBMIT_ORIGINS: { label: string; origin: unknown }[] = [
  { label: "Root", origin: { System: "Root" } },
  { label: "WhitelistedCaller", origin: { Origins: "WhitelistedCaller" } },
  { label: "ReferendumCanceller", origin: { Origins: "ReferendumCanceller" } },
  { label: "ReferendumKiller", origin: { Origins: "ReferendumKiller" } },
  { label: "GeneralAdmin", origin: { Origins: "GeneralAdmin" } },
  { label: "SmallTipper", origin: { Origins: "SmallTipper" } },
  { label: "BigTipper", origin: { Origins: "BigTipper" } },
  { label: "SmallSpender", origin: { Origins: "SmallSpender" } },
  { label: "MediumSpender", origin: { Origins: "MediumSpender" } },
  { label: "BigSpender", origin: { Origins: "BigSpender" } },
]

/**
 * Build the inner Call for a proposal spec. Throws (via the codec) if a
 * pasted raw call or runtime blob can't be decoded - surfaced to the user
 * before any signing prompt.
 */
export function buildProposalCall(api: ApiPromise, spec: ProposalCallSpec): Call {
  switch (spec.kind) {
    case "treasurySpend":
      return buildSpendLocalCall(api, {
        amount: spec.amount,
        beneficiary: spec.beneficiary,
      })
    case "cancelReferendum":
      return buildCancelReferendumCall(api, spec.index)
    case "killReferendum":
      return buildKillReferendumCall(api, spec.index)
    case "whitelistCall":
      return buildWhitelistCall(api, spec.callHash)
    case "runtimeUpgrade":
      return api.tx.system.setCode(spec.codeHex).method as Call
    case "remark":
      return api.tx.system.remark(stringToHex(spec.text)).method as Call
    case "rawCall": {
      // Decoding stops at the end of the call, so trailing bytes would be
      // dropped silently: the call must re-encode to exactly what was pasted.
      const call = api.createType("Call", spec.callHex) as unknown as Call
      if (u8aToHex(call.toU8a()) !== spec.callHex.toLowerCase()) {
        throw new Error(
          "These bytes don't decode to exactly one call - check for extra or missing bytes.",
        )
      }
      return call
    }
  }
}

/**
 * UI metadata per proposal kind: a label, a one-line description, and a
 * suggested submission origin where one is unambiguous. `suggestedOrigin` is
 * `null` for kinds whose track depends on context (treasury spend → derived
 * from amount) or is a deliberate user choice.
 *
 * Origin variants are validated against enjin v1070's `Origins` enum
 * (ReferendumCanceller / ReferendumKiller exist) and the Root track (#0).
 */
export const PROPOSAL_KIND_META: Record<
  ProposalKind,
  { label: string; description: string; suggestedOrigin: unknown | null }
> = {
  treasurySpend: {
    label: "Treasury spend",
    description: "Pay ENJ from the treasury to a beneficiary.",
    suggestedOrigin: null, // tier derived from amount
  },
  cancelReferendum: {
    label: "Cancel a referendum",
    description: "Stop an ongoing referendum and refund its deposits.",
    suggestedOrigin: { Origins: "ReferendumCanceller" },
  },
  killReferendum: {
    label: "Kill a referendum",
    description: "Stop a malicious referendum and SLASH its deposits.",
    suggestedOrigin: { Origins: "ReferendumKiller" },
  },
  whitelistCall: {
    label: "Whitelist a call",
    description: "Mark a call hash as whitelisted for the WhitelistedCaller track.",
    suggestedOrigin: null,
  },
  runtimeUpgrade: {
    label: "Runtime upgrade",
    description: "Set new runtime code (system.setCode). Root track.",
    suggestedOrigin: { System: "Root" },
  },
  remark: {
    label: "On-chain remark",
    description: "Record an arbitrary note on chain (no state change).",
    suggestedOrigin: null,
  },
  rawCall: {
    label: "Raw call (advanced)",
    description: "Paste a SCALE-encoded call to enact verbatim.",
    suggestedOrigin: null,
  },
}

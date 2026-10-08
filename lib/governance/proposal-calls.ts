/**
 * Curated proposal-call composer.
 *
 * A referendum enacts a single Call. The treasury wizard builds a
 * `spend_local`; this module, used by the advanced composer, builds the inner
 * Call for the full set of proposal types a DAO needs - treasury spends,
 * referendum admin (cancel/kill), call whitelisting, runtime upgrades
 * (authorized by code hash), on-chain remarks - plus a raw escape hatch for
 * pasting any SCALE-encoded call.
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
  | { kind: "authorizeUpgrade"; codeHash: `0x${string}` }
  | { kind: "remark"; text: string }
  | { kind: "rawCall"; callHex: `0x${string}` }

export type ProposalKind = ProposalCallSpec["kind"]

/**
 * Submission origins offered by the advanced composer, each with the name of
 * the referenda track it submits on. Root is the system origin; the rest are
 * the `pallet_custom_origins` variants that have a track - every one in the
 * `Origins` enum of Enjin specs 1070 and 1080 except `Emergency` and the
 * fellowship ranks, which have no referenda track (submitting with them
 * fails with `NoTrack`). Ordered by track id: Root and the referendum-admin
 * tracks (0-3), the admin tracks (100-112), then the treasury tracks
 * (200-204). Treasury spends derive their tier from the amount and don't
 * use this list.
 */
export const SUBMIT_ORIGINS: { label: string; origin: unknown; track: string }[] = [
  { label: "Root", origin: { System: "Root" }, track: "root" },
  { label: "WhitelistedCaller", origin: { Origins: "WhitelistedCaller" }, track: "whitelisted_caller" },
  { label: "ReferendumCanceller", origin: { Origins: "ReferendumCanceller" }, track: "referendum_canceller" },
  { label: "ReferendumKiller", origin: { Origins: "ReferendumKiller" }, track: "referendum_killer" },
  { label: "StakingAdmin", origin: { Origins: "StakingAdmin" }, track: "staking_admin" },
  { label: "TreasuryAdmin", origin: { Origins: "TreasuryAdmin" }, track: "treasury_admin" },
  { label: "LeaseAdmin", origin: { Origins: "LeaseAdmin" }, track: "lease_admin" },
  { label: "FellowshipAdmin", origin: { Origins: "FellowshipAdmin" }, track: "fellowship_admin" },
  { label: "GeneralAdmin", origin: { Origins: "GeneralAdmin" }, track: "general_admin" },
  { label: "AuctionAdmin", origin: { Origins: "AuctionAdmin" }, track: "auction_admin" },
  { label: "MultiTokensAdmin", origin: { Origins: "MultiTokensAdmin" }, track: "multi_tokens_admin" },
  { label: "FuelTanksAdmin", origin: { Origins: "FuelTanksAdmin" }, track: "fuel_tanks_admin" },
  { label: "WhitelistAdmin", origin: { Origins: "WhitelistAdmin" }, track: "whitelist_admin" },
  { label: "ParachainsAdmin", origin: { Origins: "ParachainsAdmin" }, track: "parachains_admin" },
  { label: "SmallTipper", origin: { Origins: "SmallTipper" }, track: "small_tipper" },
  { label: "BigTipper", origin: { Origins: "BigTipper" }, track: "big_tipper" },
  { label: "SmallSpender", origin: { Origins: "SmallSpender" }, track: "small_spender" },
  { label: "MediumSpender", origin: { Origins: "MediumSpender" }, track: "medium_spender" },
  { label: "BigSpender", origin: { Origins: "BigSpender" }, track: "big_spender" },
]

/**
 * Build the inner Call for a proposal spec. Throws (via the codec) if a
 * pasted raw call or code hash can't be encoded - surfaced to the user
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
    case "authorizeUpgrade":
      return api.tx.system.authorizeUpgrade(spec.codeHash).method as Call
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
  authorizeUpgrade: {
    label: "Authorize runtime upgrade",
    description:
      "Authorize new runtime code by its blake2-256 hash (system.authorizeUpgrade). Root track. Once enacted, anyone applies the matching wasm with system.applyAuthorizedUpgrade.",
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

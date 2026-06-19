/**
 * Pure extractors that normalize the "what is this proposal asking for?"
 * shape out of either:
 *   - an on-chain decoded preimage (via api.toHuman() - strings & nested objects), or
 *   - a Subscan `proposed_call.params` array (typed but loose).
 *
 * Keeping both shapes funneled into the same `ProposalIntent` lets the UI
 * render one summary card regardless of the data source.
 */

import { type ChainConfig } from "@/lib/chain/chains"
import { encodePublicKeyForChain, isValidAddressForChain } from "@/lib/chain/ss58"
import type { SubscanCallParam } from "@/lib/subscan/client"

export type TreasurySpendIntent = {
  kind: "treasury-spend"
  amount: bigint
  beneficiary: string
  /** treasury.spend (cross-chain) vs treasury.spendLocal (relay-internal). */
  method: "spend" | "spend_local" | "spendLocal"
}

export type GenericIntent = {
  kind: "generic"
  section: string
  method: string
}

export type ProposalIntent = TreasurySpendIntent | GenericIntent | null

export function intentFromSubscanCall(
  call: {
    call_module?: string
    call_name?: string
    params?: SubscanCallParam[]
  } | null | undefined,
  chain: ChainConfig,
): ProposalIntent {
  if (!call) return null
  const section = (call.call_module ?? "").toLowerCase()
  const method = call.call_name ?? ""
  const params = call.params ?? []

  if (section === "treasury" && /^spend(_local|local)?$/i.test(method)) {
    const amount = findAmountFromParams(params)
    const beneficiary = findBeneficiaryFromParams(params, chain)
    if (amount != null && beneficiary) {
      return {
        kind: "treasury-spend",
        amount,
        beneficiary,
        method: method as TreasurySpendIntent["method"],
      }
    }
  }

  return { kind: "generic", section, method }
}

function findAmountFromParams(params: SubscanCallParam[]): bigint | null {
  for (const p of params) {
    if (!/^amount$|^value$/i.test(p.name ?? "")) continue
    const v = p.value
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v)
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v))
  }
  return null
}

function findBeneficiaryFromParams(
  params: SubscanCallParam[],
  chain: ChainConfig,
): string | null {
  for (const p of params) {
    if (!/^beneficiary$|^who$|^to$|^dest$/i.test(p.name ?? "")) continue
    const addr = extractAddressFromValue(p.value, chain)
    if (addr) return addr
  }
  return null
}

/**
 * Pull a usable address out of the various shapes Subscan + on-chain
 * decoders return for AccountId32 / MultiAddress destinations:
 *   - bare SS58 string ("enD9wd…")
 *   - { Id: "enD9wd…" } or { id: "enD9wd…" } (MultiAddress::Id, decoded)
 *   - { Id: "0xeabc…" } (MultiAddress::Id, raw 32-byte hex pubkey -
 *     Subscan's free tier hands these back, and we re-encode to the
 *     active chain's SS58 prefix so the UI shows en…)
 *   - nested under .value (Subscan v2 occasionally double-wraps)
 */
function extractAddressFromValue(value: unknown, chain: ChainConfig): string | null {
  if (typeof value === "string") return normalizeAddressString(value, chain)
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>
    if (typeof v.Id === "string") return normalizeAddressString(v.Id, chain)
    if (typeof v.id === "string") return normalizeAddressString(v.id, chain)
    if (typeof v.address === "string") return normalizeAddressString(v.address, chain)
    if (v.value && typeof v.value === "object") {
      return extractAddressFromValue(v.value, chain)
    }
  }
  return null
}

function normalizeAddressString(raw: string, chain: ChainConfig): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    try {
      return encodePublicKeyForChain(raw, chain.id)
    } catch {
      return raw
    }
  }
  if (isValidAddressForChain(raw, chain.id)) return raw
  // Different SS58 prefix (e.g. polkadot 1…) - still a valid address,
  // but Subscan rarely emits one in a treasury-spend on the wrong
  // chain. Hand back as-is and let the UI decide whether to flag it.
  return raw
}

/**
 * api.toHuman() returns strings (often with thousands separators) for amounts
 * and either a string or `{ Id: <addr> }` for AccountId32 destinations.
 */
export function intentFromPreimage(
  preimage: {
    section: string
    method: string
    args: Record<string, unknown>
  } | null | undefined,
  chain: ChainConfig,
): ProposalIntent {
  if (!preimage || !preimage.section) return null
  const section = preimage.section.toLowerCase()
  const method = preimage.method ?? ""

  if (section === "treasury" && /^spend(_local|Local)?$/i.test(method)) {
    const amount = parseHumanAmount(
      preimage.args.amount ?? preimage.args.value,
    )
    const beneficiary = extractAddressFromValue(
      preimage.args.beneficiary ?? preimage.args.who ?? preimage.args.dest,
      chain,
    )
    if (amount != null && beneficiary) {
      return {
        kind: "treasury-spend",
        amount,
        beneficiary,
        method: method as TreasurySpendIntent["method"],
      }
    }
  }

  return { kind: "generic", section, method }
}

function parseHumanAmount(value: unknown): bigint | null {
  if (value == null) return null
  if (typeof value === "bigint") return value
  if (typeof value === "number") return BigInt(Math.trunc(value))
  if (typeof value === "string") {
    const stripped = value.replace(/[, _]/g, "")
    if (/^\d+$/.test(stripped)) return BigInt(stripped)
  }
  return null
}

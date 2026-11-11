/**
 * What filing a referendum through this app reserves, read from the chain,
 * and the free balance the proposer needs before signing.
 *
 * The submission batch reserves:
 *
 *  - the submission deposit, `referenda.submissionDeposit`. It comes back
 *    only if the referendum is approved or cancelled (see canRefundDeposit
 *    in ./deposits);
 *  - a preimage deposit for the call, unless it rides inline or someone
 *    already noted those bytes;
 *  - a preimage deposit for the EGOV1 envelope, unless it is already noted.
 *
 * It also pays a transaction fee, and while anything is reserved the free
 * balance can't drop below the existential deposit. filingRequirement adds
 * these up.
 *
 * The track's decision deposit is not part of it: deciding can't start
 * without it, but anyone can place it later, so the app shows it and
 * doesn't require it.
 *
 * Preimage deposits aren't a constant on Enjin: pallet_preimage holds a
 * linear price, base + perByte × length, configured in the runtime.
 * readPreimageDepositRate reads it from `preimage.baseDeposit/byteDeposit`
 * where a runtime exposes them, else by dry-running two
 * `preimage.notePreimage` calls (DryRunApi, Enjin spec 1080 on), else falls
 * back to KNOWN_PREIMAGE_RATES, measured on Enjin specs 1070 and 1080.
 */

import type { ApiPromise } from "@polkadot/api"
import { stringToU8a, u8aToHex } from "@polkadot/util"
import { randomAsU8a } from "@polkadot/util-crypto"
import type { ChainId } from "@/lib/chain/chains"
import { proposalJsonVersionKey, publicUrlFor } from "@/lib/r2/paths"
import { buildRemarkPayload } from "./proposal-metadata"

/** A preimage deposit: `base + perByte × length`, in planck. */
export type PreimageDepositRate = {
  base: bigint
  perByte: bigint
  /** Where it came from: runtime constants, a dry run, or the app's table. */
  source: "constants" | "dry-run" | "known"
}

/**
 * Preimage deposits per Enjin runtime spec (Enjin and Canary relay charge
 * the same), for runtimes that offer no way to read them. 1070 from the
 * tickets of preimages noted on mainnet; 1080 from dry runs on Canary.
 */
const KNOWN_PREIMAGE_RATES: readonly {
  specVersion: number
  base: bigint
  perByte: bigint
}[] = [
  // 1.0016 ENJ + 0.000025 ENJ per byte
  { specVersion: 1070, base: 1_001_600_000_000_000_000n, perByte: 25_000_000_000_000n },
  // 1 ENJ + 0.001 ENJ per byte
  { specVersion: 1080, base: 1_000_000_000_000_000_000n, perByte: 1_000_000_000_000_000n },
]

/** The deposit `preimage.notePreimage` holds for `len` bytes. */
export function preimageDeposit(len: number, rate: PreimageDepositRate): bigint {
  return rate.base + rate.perByte * BigInt(len)
}

/**
 * The known rate for `specVersion`: the newest listed spec at or below it,
 * or the oldest one for a runtime older than every listed spec.
 */
export function knownPreimageRate(specVersion: number): PreimageDepositRate {
  let pick = KNOWN_PREIMAGE_RATES[0]!
  for (const r of KNOWN_PREIMAGE_RATES) if (r.specVersion <= specVersion) pick = r
  return { base: pick.base, perByte: pick.perByte, source: "known" }
}

type Sample = { len: number; amount: bigint }

/**
 * The linear rate through two (length, deposit) samples. A per-byte price
 * that doesn't divide evenly is rounded up, so estimates err high. Null when
 * the samples can't describe a non-negative linear price.
 */
export function rateFromSamples(a: Sample, b: Sample): Omit<PreimageDepositRate, "source"> | null {
  const [lo, hi] = a.len <= b.len ? [a, b] : [b, a]
  const dLen = BigInt(hi.len - lo.len)
  const dAmount = hi.amount - lo.amount
  if (dLen <= 0n || dAmount < 0n) return null
  const perByte = (dAmount + dLen - 1n) / dLen
  const base = lo.amount - perByte * BigInt(lo.len)
  if (base < 0n) return null
  return { base, perByte }
}

type DryRunEvent = {
  section: string
  method: string
  data: ArrayLike<unknown> & { names?: string[] | null }
}

/**
 * The amount a dry run's events held or reserved: `balances.Held` (holds,
 * as pallet_preimage uses on Enjin) or `balances.Reserved` (older
 * runtimes). Null when there is none.
 */
export function heldAmount(events: readonly DryRunEvent[]): bigint | null {
  for (const ev of events) {
    if (ev.section !== "balances" || (ev.method !== "Held" && ev.method !== "Reserved")) continue
    const i = ev.data.names?.indexOf("amount") ?? -1
    const amount = ev.data[i >= 0 ? i : ev.data.length - 1]
    try {
      return BigInt(String(amount))
    } catch {
      return null
    }
  }
  return null
}

type DryRunResult = {
  isOk: boolean
  asOk: { executionResult: { isOk: boolean }; emittedEvents: DryRunEvent[] }
}

/** Dry-run `preimage.notePreimage` of `len` random bytes from `origin`; the deposit it held. */
async function dryRunNote(api: ApiPromise, origin: string, len: number): Promise<bigint | null> {
  const dryRunCall = api.call.dryRunApi?.dryRunCall as
    | (((...args: unknown[]) => Promise<unknown>) & { meta: { params: unknown[] } })
    | undefined
  if (!dryRunCall) return null
  const call = api.tx.preimage.notePreimage(u8aToHex(randomAsU8a(len)))
  // v1 takes (origin, call); v2 adds the XCM version to report results in.
  const xcmVersion = Number(
    (
      api.consts.xcmPallet?.advertisedXcmVersion as unknown as { toString(): string } | undefined
    )?.toString() ?? 4,
  )
  const args: unknown[] = [{ system: { Signed: origin } }, call]
  if (dryRunCall.meta.params.length > 2) args.push(xcmVersion)
  const res = (await dryRunCall(...args)) as DryRunResult
  if (!res.isOk || !res.asOk.executionResult.isOk) return null
  return heldAmount(res.asOk.emittedEvents)
}

/** `preimage.baseDeposit` + `preimage.byteDeposit`, where a runtime exposes them. */
function constantsRate(api: ApiPromise): PreimageDepositRate | null {
  const c = api.consts.preimage as Record<string, { toString(): string }> | undefined
  if (!c?.baseDeposit || !c?.byteDeposit) return null
  try {
    return {
      base: BigInt(c.baseDeposit.toString()),
      perByte: BigInt(c.byteDeposit.toString()),
      source: "constants",
    }
  } catch {
    return null
  }
}

/**
 * The connected runtime's preimage deposit rate (see the module comment).
 * `probe` is a funded account the dry runs are made from (nothing is
 * signed or sent); the chain's treasury account serves.
 */
export async function readPreimageDepositRate(
  api: ApiPromise,
  probe: string,
): Promise<PreimageDepositRate> {
  const fromConstants = constantsRate(api)
  if (fromConstants) return fromConstants
  try {
    const [small, large] = await Promise.all([
      dryRunNote(api, probe, 16),
      dryRunNote(api, probe, 1040),
    ])
    if (small != null && large != null) {
      const rate = rateFromSamples({ len: 16, amount: small }, { len: 1040, amount: large })
      if (rate) return { ...rate, source: "dry-run" }
    }
  } catch {
    // No usable dry run: the table below.
  }
  return knownPreimageRate(api.runtimeVersion.specVersion.toNumber())
}

/** A balance-typed runtime constant as bigint, or null when it's missing. */
function bigConst(value: unknown): bigint | null {
  if (value == null) return null
  try {
    return BigInt((value as { toString(): string }).toString())
  } catch {
    return null
  }
}

/** `referenda.submissionDeposit`, or null when the runtime has none. */
export function readSubmissionDeposit(api: ApiPromise): bigint | null {
  return bigConst(api.consts.referenda?.submissionDeposit)
}

/** `balances.existentialDeposit`, or null when the runtime has none. */
export function readExistentialDeposit(api: ApiPromise): bigint | null {
  return bigConst(api.consts.balances?.existentialDeposit)
}

/**
 * Byte length of the EGOV1 envelope a draft of `proposalId` will get, before
 * it is staged: the draft route builds it from the proposal JSON's public
 * URL (`<app URL>/r/<proposalJsonVersionKey>`) and the JSON's sha256, both
 * fixed-width but for the app URL. Once staged, use the real
 * `remark_payload` instead.
 */
export function estimateEnvelopeBytes(
  appUrl: string,
  network: ChainId,
  proposalId: string,
): number {
  const sha = "0".repeat(64)
  const base = `${appUrl.replace(/\/+$/, "")}/r`
  const url = publicUrlFor(base, proposalJsonVersionKey(network, proposalId, sha))
  return stringToU8a(buildRemarkPayload(url, sha)).length
}

/** UTF-8 byte length of a staged envelope. */
export function envelopeBytes(remarkPayload: string): number {
  return stringToU8a(remarkPayload).length
}

/** What a filing batch needs free, item by item. */
export type FilingRequirement = {
  submissionDeposit: bigint
  /** 0 when the call rides inline or its bytes are already noted. */
  callPreimageDeposit: bigint
  /** 0 when the envelope is already noted. */
  envelopePreimageDeposit: bigint
  /** The fee allowance plus the existential deposit that must stay free. */
  feesAndMinimum: bigint
  total: bigint
}

/**
 * Add up what the proposer must hold free to file. `callLen` / `envelopeLen`
 * are null for a preimage the batch doesn't note (inline call, already
 * noted). `submissionDeposit` is 0 for a batch that only adds details to an
 * existing referendum. The decision deposit is deliberately not included.
 */
export function filingRequirement(input: {
  submissionDeposit: bigint
  rate: PreimageDepositRate
  callLen: number | null
  envelopeLen: number | null
  feeAllowance: bigint
  existentialDeposit: bigint
}): FilingRequirement {
  const callPreimageDeposit =
    input.callLen == null ? 0n : preimageDeposit(input.callLen, input.rate)
  const envelopePreimageDeposit =
    input.envelopeLen == null ? 0n : preimageDeposit(input.envelopeLen, input.rate)
  const feesAndMinimum = input.feeAllowance + input.existentialDeposit
  return {
    submissionDeposit: input.submissionDeposit,
    callPreimageDeposit,
    envelopePreimageDeposit,
    feesAndMinimum,
    total: input.submissionDeposit + callPreimageDeposit + envelopePreimageDeposit + feesAndMinimum,
  }
}

/**
 * Allowance for the batch's transaction fee: 0.01 of a token. The fee for a
 * four-call filing batch measured about 0.000000002 ENJ on Enjin 1070 and
 * 1080, so this covers it many times over.
 */
export function feeAllowance(decimals: number): bigint {
  return 10n ** BigInt(Math.max(decimals - 2, 0))
}

import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { stringToU8a } from "@polkadot/util"
import {
  envelopeBytes,
  estimateEnvelopeBytes,
  feeAllowance,
  filingRequirement,
  heldAmount,
  knownPreimageRate,
  preimageDeposit,
  rateFromSamples,
  readExistentialDeposit,
  readPreimageDepositRate,
  readSubmissionDeposit,
  type PreimageDepositRate,
} from "@/lib/governance/filing-deposits"
import { buildRemarkPayload } from "@/lib/governance/proposal-metadata"

const ENJ = 10n ** 18n
const MILLI = 10n ** 15n

describe("preimageDeposit", () => {
  it("charges base + perByte × length", () => {
    const rate: PreimageDepositRate = { base: ENJ, perByte: MILLI, source: "known" }
    expect(preimageDeposit(0, rate)).toBe(ENJ)
    expect(preimageDeposit(45, rate)).toBe(ENJ + 45n * MILLI)
  })
})

describe("knownPreimageRate", () => {
  it("matches the tickets of preimages noted on Enjin 1070", () => {
    // Mainnet tickets: 46 bytes held 1.00275 ENJ, 183 bytes 1.006175 ENJ.
    const rate = knownPreimageRate(1070)
    expect(preimageDeposit(46, rate)).toBe(1_002_750_000_000_000_000n)
    expect(preimageDeposit(183, rate)).toBe(1_006_175_000_000_000_000n)
  })

  it("is 1 ENJ + 0.001 ENJ per byte from spec 1080", () => {
    for (const spec of [1080, 1090]) {
      const rate = knownPreimageRate(spec)
      expect(rate).toEqual({ base: ENJ, perByte: MILLI, source: "known" })
    }
  })

  it("uses the oldest listed rate for an older runtime", () => {
    expect(knownPreimageRate(1000)).toEqual(knownPreimageRate(1070))
  })
})

describe("rateFromSamples", () => {
  it("solves the line through two samples, in either order", () => {
    const a = { len: 10, amount: 1_010_000_000_000_000_000n }
    const b = { len: 100, amount: 1_100_000_000_000_000_000n }
    expect(rateFromSamples(a, b)).toEqual({ base: ENJ, perByte: MILLI })
    expect(rateFromSamples(b, a)).toEqual({ base: ENJ, perByte: MILLI })
  })

  it("rounds an uneven per-byte price up", () => {
    expect(rateFromSamples({ len: 0, amount: 10n }, { len: 3, amount: 20n })).toEqual({
      base: 10n,
      perByte: 4n,
    })
  })

  it("refuses samples that don't describe a price", () => {
    expect(rateFromSamples({ len: 5, amount: 10n }, { len: 5, amount: 10n })).toBeNull()
    expect(rateFromSamples({ len: 1, amount: 10n }, { len: 2, amount: 5n })).toBeNull()
    expect(rateFromSamples({ len: 10, amount: 1n }, { len: 20, amount: 100n })).toBeNull()
  })
})

/** A decoded event as the dry run returns it: named data fields. */
function event(section: string, method: string, fields: Record<string, unknown>) {
  const data = Object.assign(Object.values(fields), { names: Object.keys(fields) })
  return { section, method, data }
}

describe("heldAmount", () => {
  it("reads balances.Held, or balances.Reserved on older runtimes", () => {
    const held = event("balances", "Held", {
      reason: {},
      who: "en1",
      amount: "1016000000000000000",
    })
    const noted = event("preimage", "Noted", { hash_: "0x01" })
    expect(heldAmount([noted, held])).toBe(1_016_000_000_000_000_000n)
    expect(heldAmount([event("balances", "Reserved", { who: "en1", amount: 7n })])).toBe(7n)
  })

  it("is null without a hold", () => {
    expect(heldAmount([event("preimage", "Noted", { hash_: "0x01" })])).toBeNull()
  })
})

type DryRun = (origin: unknown, call: { len: number }, version?: number) => unknown

/** Just enough of an ApiPromise for readPreimageDepositRate. */
function fakeApi(opts: {
  specVersion?: number
  consts?: Record<string, string>
  dryRun?: DryRun
}): ApiPromise {
  const dryRunCall = opts.dryRun
    ? Object.assign(
        async (...args: unknown[]) =>
          opts.dryRun!(args[0], args[1] as { len: number }, args[2] as number),
        {
          meta: { params: [{}, {}, {}] },
        },
      )
    : undefined
  return {
    consts: { preimage: opts.consts ?? {}, xcmPallet: {} },
    call: dryRunCall ? { dryRunApi: { dryRunCall } } : {},
    tx: {
      preimage: {
        // hex string → its byte length
        notePreimage: (hex: string) => ({ len: (hex.length - 2) / 2 }),
      },
    },
    runtimeVersion: { specVersion: { toNumber: () => opts.specVersion ?? 1080 } },
  } as unknown as ApiPromise
}

/** A successful dry run that held base + perByte × len. */
const okDryRun =
  (base: bigint, perByte: bigint): DryRun =>
  (_origin, call) => ({
    isOk: true,
    asOk: {
      executionResult: { isOk: true },
      emittedEvents: [
        event("balances", "Held", {
          reason: {},
          who: "en1",
          amount: base + perByte * BigInt(call.len),
        }),
      ],
    },
  })

describe("readPreimageDepositRate", () => {
  it("prefers baseDeposit / byteDeposit constants where a runtime has them", async () => {
    const api = fakeApi({
      consts: { baseDeposit: "5", byteDeposit: "2" },
      dryRun: okDryRun(9n, 9n),
    })
    expect(await readPreimageDepositRate(api, "en1")).toEqual({
      base: 5n,
      perByte: 2n,
      source: "constants",
    })
  })

  it("dry-runs two notes and solves the rate", async () => {
    const seen: unknown[] = []
    const api = fakeApi({
      dryRun: (origin, call, version) => {
        seen.push({ origin, version })
        return okDryRun(ENJ, MILLI)(origin, call)
      },
    })
    expect(await readPreimageDepositRate(api, "enTreasury")).toEqual({
      base: ENJ,
      perByte: MILLI,
      source: "dry-run",
    })
    expect(seen).toEqual([
      { origin: { system: { Signed: "enTreasury" } }, version: 4 },
      { origin: { system: { Signed: "enTreasury" } }, version: 4 },
    ])
  })

  it("falls back to the known rate when the dry run fails or is missing", async () => {
    const failed = fakeApi({
      specVersion: 1070,
      dryRun: () => ({ isOk: true, asOk: { executionResult: { isOk: false }, emittedEvents: [] } }),
    })
    expect(await readPreimageDepositRate(failed, "en1")).toEqual(knownPreimageRate(1070))
    const throws = fakeApi({
      dryRun: () => {
        throw new Error("rpc down")
      },
    })
    expect(await readPreimageDepositRate(throws, "en1")).toEqual(knownPreimageRate(1080))
    expect(await readPreimageDepositRate(fakeApi({ specVersion: 1070 }), "en1")).toEqual(
      knownPreimageRate(1070),
    )
  })
})

describe("runtime constants", () => {
  const api = {
    consts: {
      referenda: { submissionDeposit: { toString: () => "1000000000000000000000" } },
      balances: { existentialDeposit: { toString: () => "100000000000000000" } },
    },
  } as unknown as ApiPromise

  it("reads the submission and existential deposits", () => {
    expect(readSubmissionDeposit(api)).toBe(1000n * ENJ)
    expect(readExistentialDeposit(api)).toBe(ENJ / 10n)
  })

  it("is null when a runtime lacks them", () => {
    const bare = { consts: {} } as unknown as ApiPromise
    expect(readSubmissionDeposit(bare)).toBeNull()
    expect(readExistentialDeposit(bare)).toBeNull()
  })
})

describe("estimateEnvelopeBytes", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000"

  it("matches the envelope the draft route builds for that proposal", () => {
    const sha = "ab".repeat(32)
    const url = `https://gov.example.org/r/proposals/enjin-relay/${id}/proposal-${sha.slice(0, 16)}.json`
    const real = buildRemarkPayload(url, sha)
    expect(estimateEnvelopeBytes("https://gov.example.org", "enjin-relay", id)).toBe(
      stringToU8a(real).length,
    )
    expect(envelopeBytes(real)).toBe(stringToU8a(real).length)
  })

  it("ignores a trailing slash on the app URL", () => {
    expect(estimateEnvelopeBytes("https://gov.example.org/", "canary-relay", id)).toBe(
      estimateEnvelopeBytes("https://gov.example.org", "canary-relay", id),
    )
  })
})

describe("filingRequirement", () => {
  const rate1080: PreimageDepositRate = { base: ENJ, perByte: MILLI, source: "dry-run" }

  it("adds the submission deposit, both preimage deposits, fees and the minimum balance", () => {
    const r = filingRequirement({
      submissionDeposit: 1000n * ENJ,
      rate: rate1080,
      callLen: 45,
      envelopeLen: 170,
      feeAllowance: feeAllowance(18),
      existentialDeposit: ENJ / 10n,
    })
    expect(r).toEqual({
      submissionDeposit: 1000n * ENJ,
      callPreimageDeposit: ENJ + 45n * MILLI,
      envelopePreimageDeposit: ENJ + 170n * MILLI,
      feesAndMinimum: ENJ / 100n + ENJ / 10n,
      total: 1000n * ENJ + 2n * ENJ + 215n * MILLI + ENJ / 100n + ENJ / 10n,
    })
  })

  it("leaves out a preimage the batch doesn't note", () => {
    const r = filingRequirement({
      submissionDeposit: 0n,
      rate: rate1080,
      callLen: null,
      envelopeLen: 170,
      feeAllowance: 0n,
      existentialDeposit: 0n,
    })
    expect(r.callPreimageDeposit).toBe(0n)
    expect(r.total).toBe(ENJ + 170n * MILLI)
  })

  it("on spec 1070, the preimages outweigh the 0.025 ENJ submission deposit", () => {
    const r = filingRequirement({
      submissionDeposit: 25n * MILLI,
      rate: knownPreimageRate(1070),
      callLen: 45,
      envelopeLen: 170,
      feeAllowance: feeAllowance(18),
      existentialDeposit: ENJ / 10n,
    })
    expect(r.callPreimageDeposit + r.envelopePreimageDeposit).toBeGreaterThan(2n * ENJ)
    expect(r.total).toBe(
      25n * MILLI + 2n * 1_001_600_000_000_000_000n + 215n * 25_000_000_000_000n + 110n * MILLI,
    )
  })
})

describe("feeAllowance", () => {
  it("is 0.01 of a token", () => {
    expect(feeAllowance(18)).toBe(10n ** 16n)
    expect(feeAllowance(2)).toBe(1n)
  })
})

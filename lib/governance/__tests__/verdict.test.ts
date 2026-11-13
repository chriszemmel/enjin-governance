import { describe, expect, it } from "vitest"
import {
  approvalOf,
  computeVerdict,
  firstPassingX,
  perbill,
  thresholdParts,
} from "@/lib/governance/verdict"
import type { OngoingStatus, Tally, Track } from "@/lib/governance/types"

const ENJ = 10n ** 18n

// Enjin Relay mainnet tracks (spec 1080), from api.consts.referenda.tracks.
const SMALL_SPENDER: Track = {
  id: 202,
  name: "small_spender",
  maxDeciding: 10,
  decisionDeposit: 12_500n * ENJ,
  preparePeriod: 2400,
  decisionPeriod: 201_600,
  confirmPeriod: 7200,
  minEnactmentPeriod: 14_400,
  minApproval: {
    type: "LinearDecreasing",
    length: 607_142_857,
    floor: 500_000_000,
    ceil: 1_000_000_000,
  },
  minSupport: {
    type: "Reciprocal",
    factor: 7_685_687n,
    xOffset: 15_149_553n,
    yOffset: -7_320_990n,
  },
}
const MEDIUM_SPENDER: Track = {
  id: 203,
  name: "medium_spender",
  maxDeciding: 10,
  decisionDeposit: 37_500n * ENJ,
  preparePeriod: 2400,
  decisionPeriod: 201_600,
  confirmPeriod: 14_400,
  minEnactmentPeriod: 14_400,
  minApproval: {
    type: "LinearDecreasing",
    length: 821_428_571,
    floor: 500_000_000,
    ceil: 1_000_000_000,
  },
  minSupport: {
    type: "Reciprocal",
    factor: 13_606_625n,
    xOffset: 26_536_314n,
    yOffset: -12_754_889n,
  },
}

// Mainnet state at finalized block 18,116,726 (13 Nov 2026). `alarm` is the
// block the chain itself scheduled its next check for.
const HEAD = 18_116_726
const TOTAL_ISSUANCE = 2_038_628_277_150_416_487_784_323_587n
const UNDECIDING_TIMEOUT = 201_600

function ongoing(o: {
  track: Track
  submitted: number
  deposit: boolean
  inQueue?: boolean
  deciding: { since: number; confirming: number | null } | null
}): OngoingStatus {
  const deposit = { who: "x", amount: 1n }
  return {
    type: "Ongoing",
    trackId: o.track.id,
    origin: null,
    proposal: { type: "Inline", bytes: new Uint8Array() },
    enactment: { type: "After", block: 14_400 },
    submitted: o.submitted,
    submissionDeposit: deposit,
    decisionDeposit: o.deposit ? deposit : null,
    deciding: o.deciding,
    tally: { ayes: 0n, nays: 0n, support: 0n },
    inQueue: o.inQueue ?? false,
    alarm: null,
  } as OngoingStatus
}

const tally = (ayes: bigint, nays: bigint, support: bigint): Tally => ({ ayes, nays, support })

function verdict(status: OngoingStatus, track: Track, t: Tally, currentBlock = HEAD) {
  return computeVerdict({
    status,
    track,
    tally: t,
    currentBlock,
    supportDenominator: TOTAL_ISSUANCE,
    undecidingTimeout: UNDECIDING_TIMEOUT,
  })
}

describe("perbill / approvalOf", () => {
  it("rounds down like Perbill::from_rational", () => {
    expect(perbill(1n, 3n)).toBe(0.333333333)
  })
  it("counts approval as zero without votes, like conviction voting", () => {
    expect(approvalOf(tally(0n, 0n, 0n))).toBe(0)
    expect(approvalOf(tally(3n, 1n, 0n))).toBe(0.75)
  })
})

describe("thresholdParts", () => {
  it("matches the runtime's fixed-point end minimum for Small and Medium Spender support", () => {
    expect(thresholdParts(SMALL_SPENDER.minSupport, 1_000_000_000n)).toBe(249_999n)
    expect(thresholdParts(MEDIUM_SPENDER.minSupport, 1_000_000_000n)).toBe(500_000n)
  })
  it("starts approval at 100% and ends at 50%", () => {
    expect(thresholdParts(SMALL_SPENDER.minApproval, 0n)).toBe(1_000_000_000n)
    expect(thresholdParts(SMALL_SPENDER.minApproval, 1_000_000_000n)).toBe(500_000_000n)
  })
})

describe("firstPassingX", () => {
  it("returns the start when the value already meets the curve", () => {
    expect(firstPassingX(SMALL_SPENDER.minApproval, 1, 0.2)).toBe(0.2)
  })
  it("returns null below the curve's end", () => {
    expect(firstPassingX(SMALL_SPENDER.minApproval, 0.49, 0)).toBeNull()
  })
  it("finds where a linear curve meets the value", () => {
    // 75% is halfway down a 100% -> 50% ramp of length 0.607.
    expect(firstPassingX(SMALL_SPENDER.minApproval, 0.75, 0)).toBeCloseTo(0.607142857 / 2, 6)
  })
  it("works on stepped curves", () => {
    const stepped = {
      type: "SteppedDecreasing" as const,
      begin: 1e9,
      end: 5e8,
      step: 1e8,
      period: 2e8,
    }
    expect(firstPassingX(stepped, 0.8, 0)).toBeCloseTo(0.4, 6)
  })
})

describe("computeVerdict on live mainnet referenda", () => {
  it("#19 is on course and meets the curves at the chain's own alarm block", () => {
    const v = verdict(
      ongoing({
        track: SMALL_SPENDER,
        submitted: 17_989_925,
        deposit: true,
        deciding: { since: 17_992_325, confirming: null },
      }),
      SMALL_SPENDER,
      tally(1_200_001n * ENJ, 0n, 675_001n * ENJ),
    )
    expect(v.kind).toBe("on-course")
    expect(v.meetsCurvesAt).toBe(18_191_756)
    expect(v.passesAt).toBe(18_191_756 + 7200)
    expect(v.decisionEnd).toBe(17_992_325 + 201_600)
    expect(v.approvalShort).toBe(false)
    expect(v.supportShort).toBe(false)
  })

  it("#20 is short on support and knows how much is missing", () => {
    const v = verdict(
      ongoing({
        track: MEDIUM_SPENDER,
        submitted: 18_107_625,
        deposit: true,
        deciding: { since: 18_110_025, confirming: null },
      }),
      MEDIUM_SPENDER,
      tally(558_393_050_000_000_000_000_000n, 0n, 219_557_100_000_000_000_000_000n),
    )
    expect(v.kind).toBe("short")
    expect(v.supportShort).toBe(true)
    expect(v.approvalShort).toBe(false)
    // 0.05% of total issuance, rounded up to the planck.
    expect(v.supportFloor).toBe((TOTAL_ISSUANCE * 500_000n + 999_999_999n) / 1_000_000_000n)
    expect(v.supportMissing).toBe(v.supportFloor - 219_557_100_000_000_000_000_000n)
    expect(v.decisionEnd).toBe(18_311_625)
  })

  it("#17 is short on approval and support", () => {
    const v = verdict(
      ongoing({
        track: MEDIUM_SPENDER,
        submitted: 17_984_313,
        deposit: true,
        deciding: { since: 17_986_713, confirming: null },
      }),
      MEDIUM_SPENDER,
      tally(800_002_010_000_000_000_000_000n, 1_275_000n * ENJ, 200_002_010_000_000_000_000_000n),
    )
    expect(v.kind).toBe("short")
    expect(v.approvalShort).toBe(true)
    expect(v.supportShort).toBe(true)
    expect(v.decisionEnd).toBe(18_188_313)
  })

  it("#18 needs a decision deposit and times out where the chain says", () => {
    const v = verdict(
      ongoing({ track: SMALL_SPENDER, submitted: 17_989_811, deposit: false, deciding: null }),
      SMALL_SPENDER,
      tally(0n, 0n, 0n),
    )
    expect(v.kind).toBe("needs-deposit")
    expect(v.timeoutAt).toBe(18_191_411)
  })
})

describe("computeVerdict states", () => {
  const decidingStatus = (confirming: number | null = null) =>
    ongoing({
      track: SMALL_SPENDER,
      submitted: 1000,
      deposit: true,
      deciding: { since: 3400, confirming },
    })

  it("is preparing until the prepare period ends", () => {
    const v = verdict(
      ongoing({ track: SMALL_SPENDER, submitted: 1000, deposit: true, deciding: null }),
      SMALL_SPENDER,
      tally(0n, 0n, 0n),
      2000,
    )
    expect(v.kind).toBe("preparing")
    expect(v.prepareEnd).toBe(3400)
  })

  it("is queued while waiting for a deciding slot", () => {
    const v = verdict(
      ongoing({
        track: SMALL_SPENDER,
        submitted: 1000,
        deposit: true,
        inQueue: true,
        deciding: null,
      }),
      SMALL_SPENDER,
      tally(1n, 0n, 1n),
      5000,
    )
    expect(v.kind).toBe("queued")
  })

  it("says no votes before anyone voted", () => {
    expect(verdict(decidingStatus(), SMALL_SPENDER, tally(0n, 0n, 0n), 5000).kind).toBe("no-votes")
  })

  it("is on track when it meets both curves today", () => {
    const v = verdict(decidingStatus(), SMALL_SPENDER, tally(10n ** 27n, 0n, 10n ** 27n), 5000)
    expect(v.kind).toBe("on-track")
    expect(v.passesAt).toBe(5001 + 7200)
  })

  it("is confirming while the chain confirms and it still passes", () => {
    const v = verdict(decidingStatus(9000), SMALL_SPENDER, tally(10n ** 27n, 0n, 10n ** 27n), 5000)
    expect(v.kind).toBe("confirming")
    expect(v.passesAt).toBe(9000)
  })

  it("is slipping while confirming but below the curves", () => {
    const v = verdict(decidingStatus(9000), SMALL_SPENDER, tally(1n, 0n, 1n), 5000)
    expect(v.kind).toBe("slipping")
    expect(v.passesAt).toBeNull()
  })

  it("is on course with support exactly at the end minimum", () => {
    const floor = computeVerdict({
      status: decidingStatus(),
      track: SMALL_SPENDER,
      tally: tally(1n, 0n, 0n),
      currentBlock: 5000,
      supportDenominator: TOTAL_ISSUANCE,
    }).supportFloor
    const v = verdict(decidingStatus(), SMALL_SPENDER, tally(10n ** 24n, 0n, floor), 5000)
    expect(v.kind).toBe("on-course")
    expect(v.meetsCurvesAt).toBeLessThanOrEqual(3400 + 201_600)
  })

  it("is short one planck below the end minimum", () => {
    const floor = computeVerdict({
      status: decidingStatus(),
      track: SMALL_SPENDER,
      tally: tally(1n, 0n, 0n),
      currentBlock: 5000,
      supportDenominator: TOTAL_ISSUANCE,
    }).supportFloor
    // One perbill below the floor, so the chain's rounding can't lift it.
    const below = floor - TOTAL_ISSUANCE / 1_000_000_000n
    expect(verdict(decidingStatus(), SMALL_SPENDER, tally(10n ** 24n, 0n, below), 5000).kind).toBe(
      "short",
    )
  })

  it("still passes at the end of the decision period, as the chain checks passing first", () => {
    const v = verdict(
      decidingStatus(),
      SMALL_SPENDER,
      tally(10n ** 24n, 0n, 600_000n * ENJ),
      3400 + 201_600,
    )
    expect(v.kind).toBe("on-track")
  })

  it("is short at the end of the decision period below the minimum", () => {
    const v = verdict(
      decidingStatus(),
      SMALL_SPENDER,
      tally(10n ** 24n, 0n, 400_000n * ENJ),
      3400 + 201_600,
    )
    expect(v.kind).toBe("short")
  })
})

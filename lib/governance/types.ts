/**
 * Normalized types for OpenGov primitives, designed for UI consumption.
 *
 * All amounts are bigint (planck). Convert to display strings via
 * lib/chain/format.ts at the UI boundary. Never round to a number until
 * it's about to render.
 *
 * These shapes are stable across chains. Pallet-specific encoding details
 * (and the api.tx/api.query calls) live in the sibling helper modules.
 */

export const CONVICTIONS = [
  "None",
  "Locked1x",
  "Locked2x",
  "Locked3x",
  "Locked4x",
  "Locked5x",
  "Locked6x",
] as const

export type Conviction = (typeof CONVICTIONS)[number]

/** Vote-weight multiplier per OpenGov conviction. None counts as 0.1x. */
export const CONVICTION_MULTIPLIER: Record<Conviction, number> = {
  None: 0.1,
  Locked1x: 1,
  Locked2x: 2,
  Locked3x: 3,
  Locked4x: 4,
  Locked5x: 5,
  Locked6x: 6,
}

/**
 * Lock periods per conviction, in units of the runtime's
 * `convictionVoting.voteLockingPeriod` - not the track's decision period.
 * A winning-side Standard vote stays locked until the referendum's end
 * block + periods × voteLockingPeriod (see `convictionLockBlocks`). None
 * imposes no lock; each step up doubles it.
 */
export const CONVICTION_LOCK_PERIODS: Record<Conviction, number> = {
  None: 0,
  Locked1x: 1,
  Locked2x: 2,
  Locked3x: 4,
  Locked4x: 8,
  Locked5x: 16,
  Locked6x: 32,
}

export type Tally = {
  ayes: bigint
  nays: bigint
  support: bigint
}

export type Deposit = {
  who: string
  amount: bigint
}

export type PreimageRef = {
  hash: `0x${string}`
  len: number
}

export type GovernanceCurve =
  | { type: "LinearDecreasing"; length: number; floor: number; ceil: number }
  | { type: "SteppedDecreasing"; begin: number; end: number; step: number; period: number }
  | { type: "Reciprocal"; factor: bigint; xOffset: bigint; yOffset: bigint }

export type Track = {
  id: number
  name: string
  maxDeciding: number
  decisionDeposit: bigint
  preparePeriod: number
  decisionPeriod: number
  confirmPeriod: number
  minEnactmentPeriod: number
  minApproval: GovernanceCurve
  minSupport: GovernanceCurve
}

export type ReferendumStatusType =
  | "Ongoing"
  | "Approved"
  | "Rejected"
  | "Cancelled"
  | "TimedOut"
  | "Killed"

export type DecidingStatus = {
  since: number
  confirming: number | null
}

export type OngoingStatus = {
  type: "Ongoing"
  trackId: number
  /** Raw origin object as encoded by the runtime (e.g. { Origins: 'SmallTipper' }). */
  origin: unknown
  proposal: PreimageRef | { type: "Inline"; bytes: Uint8Array }
  enactment: { type: "At" | "After"; block: number }
  submitted: number
  submissionDeposit: Deposit
  decisionDeposit: Deposit | null
  deciding: DecidingStatus | null
  tally: Tally
  inQueue: boolean
  alarm: { when: number } | null
}

export type TerminalStatus = {
  type: Exclude<ReferendumStatusType, "Ongoing" | "Killed">
  at: number
  submissionDeposit: Deposit | null
  decisionDeposit: Deposit | null
}

export type KilledStatus = {
  type: "Killed"
  at: number
}

export type ReferendumStatus = OngoingStatus | TerminalStatus | KilledStatus

export type Referendum = {
  index: number
  status: ReferendumStatus
  /** Convenience: trackId pulled out of Ongoing. Null for terminal states. */
  trackId: number | null
  /** Convenience: tally pulled out of Ongoing. Null for terminal states (tally is frozen on chain). */
  tally: Tally | null
}

export type VoteRecord =
  | {
      type: "Standard"
      pollIndex: number
      trackId: number
      aye: boolean
      balance: bigint
      conviction: Conviction
    }
  | {
      type: "Split"
      pollIndex: number
      trackId: number
      aye: bigint
      nay: bigint
    }
  | {
      type: "SplitAbstain"
      pollIndex: number
      trackId: number
      aye: bigint
      nay: bigint
      abstain: bigint
    }

export type ClassLock = {
  trackId: number
  amount: bigint
}

export type PreimageStatus = "Unrequested" | "Requested" | "Missing"

export type Preimage = {
  hash: `0x${string}`
  len: number
  status: PreimageStatus
  bytes: Uint8Array | null
}

/**
 * A treasury-spending track with its maximum spend amount.
 * maxAmount=null marks an unbounded tier; the Enjin tables are fully bounded
 * (the top tier, TreasuryAdmin, is capped), so a null is not expected there.
 */
export type TreasuryTier = {
  origin: string
  maxAmount: bigint | null
}

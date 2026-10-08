/**
 * Lifecycle progression for an OpenGov referendum.
 *
 * Maps a Referendum + Track + current block height (+ what the chain says
 * about its enactment and payout) into what the UI shows:
 *
 *   - four stages, Prepare → Decide → Confirm → Enact, each one of
 *     {done, active, upcoming, skipped, cancelled, failed, unknown};
 *   - a timeline of the events with their blocks, Subscan style
 *     (Submitted, Decision started, Confirm started, Approved, Enactment
 *     scheduled / Executed, Payout);
 *   - for a treasury `spend_local`, where its payout stands.
 *
 * Approved is not the end: the call is enacted later, by the scheduler, at
 * `max(desired, approval + track.minEnactmentPeriod)` (see
 * `enactmentBlock`). Mainnet referendum #12 was approved at 17,533,282 and
 * enacted a day later at 17,547,682. So an Approved referendum's Enact stage
 * follows the scheduler (`EnactmentState`): still scheduled → active, gone →
 * done. A spend_local then waits for the treasury's next spend period.
 *
 * Whatever can't be determined stays "unknown" rather than getting a check.
 *
 * Pure functions only. No React, no chain calls. Feed it the data you have.
 */

import { nextSpendPeriodBlock, type PayoutStatus } from "./payout"
import { type EnactmentRecord, enactmentBlock, type TaskAddress } from "./scheduler"
import type { OngoingStatus, Referendum, Track } from "./types"

export type LifecycleStageId = "prepare" | "decide" | "confirm" | "enact"

export type LifecycleStageState =
  // The referendum has passed through this stage.
  | "done"
  // The referendum is currently in this stage.
  | "active"
  // This stage hasn't started yet.
  | "upcoming"
  // The referendum bypassed this stage (e.g. rejected before enactment).
  | "skipped"
  // The referendum cannot reach this stage from its current terminal state.
  | "cancelled"
  // The stage ran and failed (an enacted call that returned an error).
  | "failed"
  // Can't be told from what's known (e.g. the scheduler hasn't been read).
  | "unknown"

export type LifecycleStage = {
  id: LifecycleStageId
  label: string
  /** Block where the stage begins. Null when not yet scheduled or unknown. */
  startBlock: number | null
  /** Block where the stage ends. Null when not yet scheduled, unbounded or unknown. */
  endBlock: number | null
  /** Length of the stage in blocks: from the chain when known, else the track config. */
  durationBlocks: number
  /**
   * Block the stage completes at: `endBlock` once the chain fixes it, else a
   * projection from the track periods (`expectedApprox`). For Decide, the
   * block it handed over to Confirm. Null when it can't be told.
   */
  expectedEnd: number | null
  /** `expectedEnd` is a projection that holds only if the referendum passes. */
  expectedApprox: boolean
  state: LifecycleStageState
  /** 0..1 - only meaningful when state === "active". */
  progress: number
}

export type TimelineEventId =
  | "submitted"
  | "decision"
  | "confirm-started"
  | "confirmed"
  | "rejected"
  | "timedout"
  | "cancelled"
  | "killed"
  | "enactment"
  | "payout"

export type TimelineEvent = {
  id: TimelineEventId
  label: string
  /** Null when the event happened (or will) at a block that isn't known. */
  block: number | null
  /** The block is an estimate: projected, or reconstructed after the fact. */
  approx: boolean
  status: "done" | "upcoming" | "failed" | "unknown"
  /** Short qualifier shown with the event, e.g. "if the treasury can cover it". */
  note?: string
}

/** Where a treasury spend's payout stands, for display. */
export type PayoutView = {
  state: "upcoming" | "active" | "done" | "skipped" | "unknown"
  /** Active: the spend period it's due at. Upcoming: an estimate, if any. */
  block: number | null
  approx: boolean
  /** The treasury proposal index, when known. */
  proposalIndex: number | null
  /** Active: the block the call was enacted at, where the wait began. */
  since?: number | null
}

export type Lifecycle = {
  stages: LifecycleStage[]
  /** id of the stage in progress, or null when nothing is (decided and enacted, or ended). */
  activeStageId: LifecycleStageId | null
  /**
   * Overall progress through the lifecycle, 0..1. Treats each stage as an
   * equal-weight segment of the journey (UI-pleasing rather than
   * time-accurate - confirm/enact are typically much shorter than decide,
   * but we don't want a 14-day decide window to overwhelm the bar).
   */
  overallProgress: number
  /**
   * The terminal outcome for this referendum, if it has one.
   */
  terminal: "approved" | "rejected" | "cancelled" | "timedout" | "killed" | null
  /** True when the deciding stage is blocked on the decision deposit being placed. */
  awaitingDecisionDeposit: boolean
  /**
   * While deciding: the block the runtime will start confirming at, from its
   * alarm (the point where the support curve meets the current tally). Null
   * when confirming already, or when the alarm is just the end of the period.
   */
  confirmStartsAt: number | null
  /** Events with their blocks, oldest first. */
  timeline: TimelineEvent[]
  /** Null unless the call is a treasury spend_local (`LifecycleContext.spend`). */
  payout: PayoutView | null
}

/**
 * Where an Approved referendum's call stands in the scheduler
 * (`scheduler.lookup` of its enactment task, plus the archive record).
 */
export type EnactmentState =
  /** Not read yet, unreadable, or the task didn't run where it was scheduled. */
  | { status: "unknown" }
  /** Waiting in the scheduler for `block`. */
  | { status: "scheduled"; block: number }
  /**
   * Gone from the scheduler: it ran. `block` and `ok` come from the archive
   * (the task's block and its `Dispatched` result), null when not recovered.
   */
  | { status: "executed"; block: number | null; ok: boolean | null }

/**
 * Combine the live `scheduler.lookup` of the enactment task (`undefined`
 * while not read) with the archive record of its run (`undefined` while
 * not read, null when the archive couldn't tell). A record that found no
 * `Dispatched` for the task at its block means it didn't run there
 * (cancelled, or postponed): unknown, not done.
 */
export function enactmentStateFrom(
  task: TaskAddress | null | undefined,
  record: EnactmentRecord | null | undefined,
): EnactmentState {
  if (task === undefined) return { status: "unknown" }
  if (task) return { status: "scheduled", block: task.block }
  if (record && record.ok === null) return { status: "unknown" }
  return { status: "executed", block: record?.block ?? null, ok: record?.ok ?? null }
}

/** For a treasury spend_local: what the payout stage needs. */
export type SpendContext = {
  /** `treasury.spendPeriod`, when known. */
  spendPeriod: number | null
  /** After enactment: where the treasury proposal stands. */
  payout: PayoutStatus
}

export type LifecycleContext = {
  /**
   * For a decided referendum: its Ongoing status at the block before the
   * decision (read from the archive). Places the earlier stages' blocks.
   */
  history?: OngoingStatus | null
  /** For an Approved referendum: the scheduler's view of its enactment. */
  enactment?: EnactmentState
  /** Present for a treasury spend_local: adds the payout. */
  spend?: SpendContext | null
}

const STAGE_IDS: LifecycleStageId[] = ["prepare", "decide", "confirm", "enact"]

const STAGE_LABELS: Record<LifecycleStageId, string> = {
  prepare: "Prepare",
  decide: "Decide",
  confirm: "Confirm",
  enact: "Enact",
}

const PAYOUT_NOTE = "if the treasury can cover it"

/**
 * Build the lifecycle view-model for a referendum.
 *
 * `currentBlock` may be null while the chain head hasn't loaded - in that
 * case stages are still placed but progress for the active stage is 0.
 */
export function getLifecycle(
  referendum: Referendum,
  track: Track | null,
  currentBlock: number | null,
  context: LifecycleContext = {},
): Lifecycle {
  if (referendum.status.type !== "Ongoing") {
    return buildTerminalLifecycle(referendum, track, currentBlock, context)
  }
  return buildOngoingLifecycle(referendum.status, track, currentBlock, context)
}

function buildOngoingLifecycle(
  status: OngoingStatus,
  track: Track | null,
  currentBlock: number | null,
  context: LifecycleContext,
): Lifecycle {
  const prep = track?.preparePeriod ?? 0
  const dec = track?.decisionPeriod ?? 0
  const conf = track?.confirmPeriod ?? 0
  const minEnact = track?.minEnactmentPeriod ?? 0

  const prepareStart = status.submitted
  const prepareEnd = status.submitted + prep

  // deciding.since is set when the runtime advances the poll out of prepare.
  // Before that, decideStart is *projected* at prepareEnd, but it can be
  // delayed if the decision deposit hasn't been placed yet.
  const decideStart = status.deciding?.since ?? prepareEnd
  const decideEnd = decideStart + dec

  // deciding.confirming holds the block at which the *current* confirm
  // window ends, IF the threshold is still being met. If it's been cleared
  // (dropped out of threshold), the confirm window resets. Holding through
  // it approves the referendum at that block.
  const confirmEnd = status.deciding?.confirming ?? null
  const confirmStart = confirmEnd != null ? confirmEnd - conf : null

  // The runtime schedules the call for max(desired, approval + minEnactment).
  const enactStart = confirmEnd
  const enactEnd =
    confirmEnd != null ? enactmentBlock(status.enactment, confirmEnd, minEnact) : null
  const enactDuration =
    enactStart != null && enactEnd != null
      ? enactEnd - enactStart
      : status.enactment.type === "After"
        ? Math.max(status.enactment.block, minEnact)
        : minEnact

  const awaitingDecisionDeposit =
    status.decisionDeposit == null && status.deciding == null

  // While deciding, the alarm is the earlier of the period's end and the
  // block where the support curve falls to the current tally: from there
  // the referendum confirms unless the votes change.
  const alarm = status.alarm?.when ?? null
  const confirmStartsAt =
    status.deciding != null && confirmEnd == null && alarm != null && alarm < decideEnd
      ? alarm
      : null
  // If it passes: approved when its confirm period ends (at the latest one
  // period after Decide does), enacted per the runtime's formula, paid at
  // the next spend period.
  const expectedConfirmEnd = confirmEnd ?? (confirmStartsAt ?? decideEnd) + conf
  const expectedEnact = enactmentBlock(status.enactment, expectedConfirmEnd, minEnact)

  // Decide which stage is currently active.
  const now = currentBlock ?? prepareStart
  let activeStageId: LifecycleStageId
  if (status.deciding?.confirming != null) {
    activeStageId = "confirm"
  } else if (status.deciding != null) {
    activeStageId = "decide"
  } else {
    // Inside the prepare period, or past it with no decision deposit yet -
    // still effectively "preparing" from the user's perspective.
    activeStageId = "prepare"
  }

  const stage = (
    id: LifecycleStageId,
    start: number | null,
    end: number | null,
    duration: number,
    expected: number | null,
    approx: boolean,
  ) => ({
    ...buildStage(id, start, end, duration, activeStageId, now, currentBlock),
    expectedEnd: expected,
    expectedApprox: approx,
  })

  const stages: LifecycleStage[] = [
    // Prepare really ends when deciding starts (later, when the deposit or
    // a deciding slot came late).
    stage(
      "prepare",
      prepareStart,
      status.deciding?.since ?? prepareEnd,
      prep,
      status.deciding?.since ?? prepareEnd,
      status.deciding == null,
    ),
    stage(
      "decide",
      status.deciding != null ? decideStart : null,
      status.deciding != null ? decideEnd : null,
      dec,
      confirmStart ?? decideEnd,
      status.deciding == null,
    ),
    stage("confirm", confirmStart, confirmEnd, conf, expectedConfirmEnd, confirmEnd == null),
    stage("enact", enactStart, enactEnd, enactDuration, expectedEnact, true),
  ]

  const timeline: TimelineEvent[] = [
    { id: "submitted", label: "Submitted", block: status.submitted, approx: false, status: "done" },
  ]
  if (status.deciding) {
    timeline.push({
      id: "decision",
      label: "Decision started",
      block: status.deciding.since,
      approx: false,
      status: "done",
    })
  }
  if (confirmStart != null && confirmEnd != null) {
    timeline.push(
      {
        id: "confirm-started",
        label: "Confirm started",
        block: confirmStart,
        approx: false,
        status: "done",
      },
      { id: "confirmed", label: "Confirm ends", block: confirmEnd, approx: false, status: "upcoming" },
      { id: "enactment", label: "Enactment", block: enactEnd, approx: true, status: "upcoming" },
    )
  }

  let payout: PayoutView | null = null
  if (context.spend) {
    const sp = context.spend.spendPeriod
    const block = sp ? nextSpendPeriodBlock(expectedEnact, sp) : null
    payout = { state: "upcoming", block, approx: true, proposalIndex: null }
    if (block != null && confirmEnd != null) {
      timeline.push({ id: "payout", label: "Payout", block, approx: true, status: "upcoming" })
    }
  }

  return {
    stages,
    activeStageId,
    overallProgress: computeOverallProgress(stages),
    terminal: null,
    awaitingDecisionDeposit,
    confirmStartsAt,
    timeline,
    payout,
  }
}

function buildStage(
  id: LifecycleStageId,
  startBlock: number | null,
  endBlock: number | null,
  durationBlocks: number,
  activeId: LifecycleStageId,
  now: number,
  currentBlock: number | null,
): LifecycleStage {
  const myIdx = STAGE_IDS.indexOf(id)
  const activeIdx = STAGE_IDS.indexOf(activeId)

  let state: LifecycleStageState
  if (myIdx < activeIdx) {
    state = "done"
  } else if (myIdx === activeIdx) {
    state = "active"
  } else {
    state = "upcoming"
  }

  let progress = 0
  if (state === "active" && startBlock != null && currentBlock != null && durationBlocks > 0) {
    progress = clamp01((now - startBlock) / durationBlocks)
  } else if (state === "done") {
    progress = 1
  }

  return {
    id,
    label: STAGE_LABELS[id],
    startBlock,
    endBlock,
    durationBlocks,
    expectedEnd: endBlock,
    expectedApprox: false,
    state,
    progress,
  }
}

function computeOverallProgress(stages: LifecycleStage[]): number {
  // Each stage is one quarter of the bar. Done stages count fully,
  // the active stage contributes proportional to its inner progress.
  const segment = 1 / stages.length
  let total = 0
  for (const s of stages) {
    if (s.state === "done" || s.state === "failed") total += segment
    else if (s.state === "active") total += segment * s.progress
  }
  return clamp01(total)
}

const TERMINAL: Record<Exclude<Referendum["status"]["type"], "Ongoing">, Lifecycle["terminal"]> = {
  Approved: "approved",
  Rejected: "rejected",
  Cancelled: "cancelled",
  TimedOut: "timedout",
  Killed: "killed",
}

const TERMINAL_EVENT: Record<
  Exclude<Referendum["status"]["type"], "Ongoing">,
  { id: TimelineEventId; label: string }
> = {
  Approved: { id: "confirmed", label: "Approved" },
  Rejected: { id: "rejected", label: "Rejected" },
  Cancelled: { id: "cancelled", label: "Cancelled" },
  TimedOut: { id: "timedout", label: "Timed out" },
  Killed: { id: "killed", label: "Killed" },
}

function buildTerminalLifecycle(
  referendum: Referendum,
  track: Track | null,
  currentBlock: number | null,
  context: LifecycleContext,
): Lifecycle {
  const status = referendum.status
  if (status.type === "Ongoing") throw new Error("not a terminal referendum")
  const terminal = TERMINAL[status.type]
  const decidedAt = status.at
  const history = context.history ?? null

  const prep = track?.preparePeriod ?? 0
  const dec = track?.decisionPeriod ?? 0
  const conf = track?.confirmPeriod ?? 0
  const minEnact = track?.minEnactmentPeriod ?? 0

  const approved = terminal === "approved"
  const cancelled = terminal === "cancelled" || terminal === "killed"
  const timedOut = terminal === "timedout"

  // What the history (the Ongoing status just before the decision) tells.
  const submitted = history?.submitted ?? null
  const since = history?.deciding?.since ?? null
  const confirmEnd = history?.deciding?.confirming ?? null
  const confirmStart = confirmEnd != null && track ? confirmEnd - conf : null

  const fixed = (
    id: LifecycleStageId,
    state: LifecycleStageState,
    startBlock: number | null,
    endBlock: number | null,
    durationBlocks: number,
  ): LifecycleStage => ({
    id,
    label: STAGE_LABELS[id],
    startBlock,
    endBlock,
    durationBlocks,
    expectedEnd: endBlock,
    expectedApprox: false,
    state,
    progress: state === "done" || state === "failed" ? 1 : 0,
  })

  const decidedState: LifecycleStageState = cancelled ? "cancelled" : "done"
  const laterState: LifecycleStageState = cancelled ? "cancelled" : "skipped"

  const stages: LifecycleStage[] = [
    fixed("prepare", decidedState, submitted, since ?? (timedOut ? decidedAt : null), prep),
    fixed(
      "decide",
      timedOut ? "skipped" : decidedState,
      since,
      approved ? confirmStart : terminal === "rejected" ? decidedAt : null,
      dec,
    ),
    fixed(
      "confirm",
      approved ? "done" : laterState,
      approved ? confirmStart : null,
      approved ? decidedAt : null,
      conf,
    ),
  ]

  // The rows an outcome always has are listed even before the history
  // arrives (block null until then), so the list doesn't grow under the
  // reader once the archive answers.
  const decided = approved || terminal === "rejected"
  const timeline: TimelineEvent[] = [
    { id: "submitted", label: "Submitted", block: submitted, approx: false, status: "done" },
  ]
  if (decided || since != null) {
    timeline.push({ id: "decision", label: "Decision started", block: since, approx: false, status: "done" })
  }
  if (approved) {
    timeline.push({
      id: "confirm-started",
      label: "Confirm started",
      block: confirmStart,
      approx: false,
      status: "done",
    })
  }
  const ending = TERMINAL_EVENT[status.type]
  timeline.push({ ...ending, block: decidedAt, approx: false, status: "done" })

  let activeStageId: LifecycleStageId | null = null
  let payout: PayoutView | null = null

  if (!approved) {
    stages.push(fixed("enact", laterState, null, null, minEnact))
  } else {
    const enactment = context.enactment ?? { status: "unknown" }
    // When the exact block isn't known: the runtime's formula with the
    // desired enactment from history, else the track's minimum.
    const estimate = history
      ? enactmentBlock(history.enactment, decidedAt, minEnact)
      : track
        ? enactmentBlock({ type: "After", block: 0 }, decidedAt, minEnact)
        : null

    let enact: LifecycleStage
    let enactEvent: TimelineEvent
    let enactedAt: number | null = null
    switch (enactment.status) {
      case "scheduled": {
        const duration = Math.max(enactment.block - decidedAt, 0)
        const progress =
          currentBlock != null && duration > 0 ? clamp01((currentBlock - decidedAt) / duration) : 0
        enact = {
          id: "enact",
          label: STAGE_LABELS.enact,
          startBlock: decidedAt,
          endBlock: enactment.block,
          durationBlocks: duration,
          expectedEnd: enactment.block,
          expectedApprox: false,
          state: "active",
          progress,
        }
        activeStageId = "enact"
        enactEvent = {
          id: "enactment",
          label: "Enactment scheduled",
          block: enactment.block,
          approx: false,
          status: "upcoming",
        }
        break
      }
      case "executed": {
        const block = enactment.block ?? estimate
        const failed = enactment.ok === false
        enactedAt = block
        enact = fixed(
          "enact",
          failed ? "failed" : "done",
          decidedAt,
          block,
          block != null ? block - decidedAt : minEnact,
        )
        enactEvent = {
          id: "enactment",
          label: "Executed",
          block,
          approx: enactment.block == null,
          status: failed ? "failed" : "done",
          ...(failed ? { note: "the call failed" } : {}),
        }
        break
      }
      default: {
        enact = {
          ...fixed("enact", "unknown", decidedAt, null, estimate != null ? estimate - decidedAt : minEnact),
          expectedEnd: estimate,
          expectedApprox: true,
        }
        enactEvent = {
          id: "enactment",
          label: "Enactment",
          block: estimate,
          approx: true,
          status: "unknown",
        }
      }
    }
    stages.push(enact)
    timeline.push(enactEvent)

    if (context.spend) {
      payout = approvedPayout(enactment, enactedAt, context.spend, currentBlock)
      timeline.push(payoutEvent(payout))
    }
  }

  return {
    stages,
    activeStageId,
    overallProgress: computeOverallProgress(stages),
    terminal,
    awaitingDecisionDeposit: false,
    confirmStartsAt: null,
    timeline,
    payout,
  }
}

function approvedPayout(
  enactment: EnactmentState,
  enactedAt: number | null,
  spend: SpendContext,
  currentBlock: number | null,
): PayoutView {
  const sp = spend.spendPeriod
  if (enactment.status === "scheduled") {
    return {
      state: "upcoming",
      block: sp ? nextSpendPeriodBlock(enactment.block, sp) : null,
      approx: true,
      proposalIndex: null,
    }
  }
  if (enactment.status !== "executed") {
    return { state: "unknown", block: null, approx: false, proposalIndex: null }
  }
  if (enactment.ok === false) {
    return { state: "skipped", block: null, approx: false, proposalIndex: null }
  }
  switch (spend.payout.status) {
    case "pending": {
      const from = currentBlock ?? enactedAt
      return {
        state: "active",
        block: sp && from != null ? nextSpendPeriodBlock(from, sp) : null,
        approx: false,
        proposalIndex: spend.payout.proposalIndex,
        since: enactedAt,
      }
    }
    case "paid":
      return { state: "done", block: null, approx: false, proposalIndex: spend.payout.proposalIndex }
    case "none":
      return { state: "skipped", block: null, approx: false, proposalIndex: null }
    default:
      return { state: "unknown", block: null, approx: false, proposalIndex: null }
  }
}

function payoutEvent(payout: PayoutView): TimelineEvent {
  switch (payout.state) {
    case "active":
      return {
        id: "payout",
        label: "Payout",
        block: payout.block,
        approx: false,
        status: "upcoming",
        note: PAYOUT_NOTE,
      }
    case "done":
      return { id: "payout", label: "Paid out", block: null, approx: false, status: "done" }
    case "skipped":
      return { id: "payout", label: "No payout", block: null, approx: false, status: "failed" }
    case "upcoming":
      return { id: "payout", label: "Payout", block: payout.block, approx: true, status: "upcoming" }
    default:
      return { id: "payout", label: "Payout", block: null, approx: false, status: "unknown" }
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

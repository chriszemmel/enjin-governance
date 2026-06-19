/**
 * Lifecycle progression for an OpenGov referendum.
 *
 * Maps a Referendum + Track + current block height into the four-stage
 * journey users see in the UI:
 *
 *   Prepare → Decide → Confirm → Enact
 *
 * Each stage has a deterministic block range derived from the track config
 * and the on-chain status (submitted block, deciding.since, deciding.confirming,
 * enactment.block). The runtime can move stages around - a poll that meets
 * the threshold instantly skips from Decide into Confirm; a poll that drops
 * out of confirm goes back to Decide - but the *visualisable* set of stages
 * stays the same. We pick one of {done, active, upcoming, skipped} per stage
 * so the UI can render a stepper without re-deriving the semantics.
 *
 * Pure functions only. No React, no chain calls. Feed it the data you have.
 */

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

export type LifecycleStage = {
  id: LifecycleStageId
  label: string
  /** Block where the stage begins. Null when not yet scheduled. */
  startBlock: number | null
  /** Block where the stage ends. Null when not yet scheduled or unbounded. */
  endBlock: number | null
  /** Length of the stage in blocks. Comes straight from the track config. */
  durationBlocks: number
  state: LifecycleStageState
  /** 0..1 - only meaningful when state === "active". */
  progress: number
}

export type Lifecycle = {
  stages: LifecycleStage[]
  /** id of the currently active stage, or null when the referendum is terminal. */
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
}

const STAGE_LABELS: Record<LifecycleStageId, string> = {
  prepare: "Prepare",
  decide: "Decide",
  confirm: "Confirm",
  enact: "Enact",
}

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
): Lifecycle {
  if (referendum.status.type !== "Ongoing") {
    return buildTerminalLifecycle(referendum, track)
  }
  return buildOngoingLifecycle(referendum.status, track, currentBlock)
}

function buildOngoingLifecycle(
  status: OngoingStatus,
  track: Track | null,
  currentBlock: number | null,
): Lifecycle {
  const prep = track?.preparePeriod ?? 0
  const dec = track?.decisionPeriod ?? 0
  const conf = track?.confirmPeriod ?? 0
  const enact = track?.minEnactmentPeriod ?? 0

  const prepareStart = status.submitted
  const prepareEnd = status.submitted + prep

  // deciding.since is set when the runtime advances the poll out of prepare.
  // Before that, decideStart is *projected* at prepareEnd, but it can be
  // delayed if the decision deposit hasn't been placed yet.
  const decideStart = status.deciding?.since ?? prepareEnd
  const decideEnd = decideStart + dec

  // deciding.confirming holds the block at which the *current* confirm
  // window ends, IF the threshold is still being met. If it's been cleared
  // (dropped out of threshold), the confirm window resets.
  const confirmEnd = status.deciding?.confirming ?? null
  const confirmStart = confirmEnd != null ? confirmEnd - conf : null

  const enactStart = confirmEnd ?? null
  const enactEnd = enactStart != null ? enactStart + enact : null

  const awaitingDecisionDeposit =
    status.decisionDeposit == null && status.deciding == null

  // Decide which stage is currently active.
  const now = currentBlock ?? prepareStart
  let activeStageId: LifecycleStageId
  if (status.deciding?.confirming != null) {
    activeStageId = "confirm"
  } else if (status.deciding != null) {
    activeStageId = "decide"
  } else if (now < prepareEnd) {
    activeStageId = "prepare"
  } else {
    // Prepare period is over but no decision deposit yet - still effectively
    // "preparing" from the user's perspective (waiting on deposit).
    activeStageId = "prepare"
  }

  const stages: LifecycleStage[] = [
    buildStage(
      "prepare",
      prepareStart,
      prepareEnd,
      prep,
      activeStageId,
      now,
      currentBlock,
    ),
    buildStage(
      "decide",
      status.deciding != null ? decideStart : null,
      status.deciding != null ? decideEnd : null,
      dec,
      activeStageId,
      now,
      currentBlock,
    ),
    buildStage(
      "confirm",
      confirmStart,
      confirmEnd,
      conf,
      activeStageId,
      now,
      currentBlock,
    ),
    buildStage(
      "enact",
      enactStart,
      enactEnd,
      enact,
      activeStageId,
      now,
      currentBlock,
    ),
  ]

  return {
    stages,
    activeStageId,
    overallProgress: computeOverallProgress(stages),
    terminal: null,
    awaitingDecisionDeposit,
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
  const ordered: LifecycleStageId[] = ["prepare", "decide", "confirm", "enact"]
  const myIdx = ordered.indexOf(id)
  const activeIdx = ordered.indexOf(activeId)

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
    if (s.state === "done") total += segment
    else if (s.state === "active") total += segment * s.progress
  }
  return clamp01(total)
}

function buildTerminalLifecycle(referendum: Referendum, track: Track | null): Lifecycle {
  const status = referendum.status
  const terminal: Lifecycle["terminal"] =
    status.type === "Approved"
      ? "approved"
      : status.type === "Rejected"
        ? "rejected"
        : status.type === "Cancelled"
          ? "cancelled"
          : status.type === "TimedOut"
            ? "timedout"
            : status.type === "Killed"
              ? "killed"
              : null

  // For terminal states we don't have the original phase blocks. Show all
  // four stages with semantically correct states so the visual stepper
  // still tells the story.
  const prep = track?.preparePeriod ?? 0
  const dec = track?.decisionPeriod ?? 0
  const conf = track?.confirmPeriod ?? 0
  const enact = track?.minEnactmentPeriod ?? 0

  const approved = terminal === "approved"
  const negative = terminal === "rejected" || terminal === "timedout"
  const cancelled = terminal === "cancelled" || terminal === "killed"

  const decidedState: LifecycleStageState = cancelled ? "cancelled" : "done"
  const confirmState: LifecycleStageState = approved
    ? "done"
    : cancelled
      ? "cancelled"
      : negative
        ? "skipped"
        : "upcoming"
  const enactState: LifecycleStageState = approved
    ? "done"
    : cancelled
      ? "cancelled"
      : negative
        ? "skipped"
        : "upcoming"

  const stages: LifecycleStage[] = [
    {
      id: "prepare",
      label: STAGE_LABELS.prepare,
      startBlock: null,
      endBlock: null,
      durationBlocks: prep,
      state: decidedState,
      progress: cancelled ? 0 : 1,
    },
    {
      id: "decide",
      label: STAGE_LABELS.decide,
      startBlock: null,
      endBlock: null,
      durationBlocks: dec,
      state: decidedState,
      progress: cancelled ? 0 : 1,
    },
    {
      id: "confirm",
      label: STAGE_LABELS.confirm,
      startBlock: null,
      endBlock: null,
      durationBlocks: conf,
      state: confirmState,
      progress: confirmState === "done" ? 1 : 0,
    },
    {
      id: "enact",
      label: STAGE_LABELS.enact,
      startBlock: null,
      endBlock: null,
      durationBlocks: enact,
      state: enactState,
      progress: enactState === "done" ? 1 : 0,
    },
  ]

  return {
    stages,
    activeStageId: null,
    overallProgress: approved ? 1 : 0,
    terminal,
    awaitingDecisionDeposit: false,
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

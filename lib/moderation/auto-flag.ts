/**
 * Automatic checks wired into the write paths (patch v1.5).
 *
 *   checkUpload   runs before an image is stored: "block" rejects it,
 *                 "review" (or a model refusal) stores it blurred and puts
 *                 it in the moderators' queue.
 *   flagText      runs after the response (next/server `after`) for
 *                 proposal text and comments; it can only add a queue
 *                 entry, never hide anything.
 *
 * Scan failures never block posting - the item is handled as if scanning
 * were off.
 */

import "server-only"
import { after } from "next/server"
import { insertReport, setState } from "@/lib/db/moderation"
import { categoryFor, scanEnabled, scanImage, scanText, type ScanOutcome } from "./scan"
import type { ModerationTarget } from "./policy"

type UploadDecision =
  | { action: "store" }
  | { action: "store_blurred"; outcome: ScanOutcome }
  | { action: "reject"; message: string }

export async function checkUpload(
  jpeg: () => Promise<Buffer>,
  fileName: string,
): Promise<UploadDecision> {
  if (!scanEnabled()) return { action: "store" }
  let outcome: ScanOutcome
  try {
    outcome = await scanImage(await jpeg(), { fileName })
  } catch {
    return { action: "store" }
  }
  if (outcome.kind === "refused") return { action: "store_blurred", outcome }
  if (outcome.kind !== "verdict") return { action: "store" }
  const v = outcome.verdict
  if (v.decision === "block") {
    return {
      action: "reject",
      message: `This image can't be published: ${v.explanation} If you think this is wrong, ask a moderator.`,
    }
  }
  return v.decision === "review" ? { action: "store_blurred", outcome } : { action: "store" }
}

function detailsOf(outcome: ScanOutcome) {
  return outcome.kind === "verdict"
    ? {
        decision: outcome.verdict.decision,
        labels: outcome.verdict.labels,
        explanation: outcome.verdict.explanation,
      }
    : {
        decision: "review",
        labels: [],
        explanation: "The automatic check declined to classify this.",
      }
}

/** Blur a just-stored upload and queue it for a moderator. */
export async function queueBlurredUpload(
  key: string,
  proposalId: string | null,
  outcome: ScanOutcome,
) {
  const details = detailsOf(outcome)
  const verdict = outcome.kind === "verdict" ? outcome.verdict : null
  await setState({
    targetType: "attachment",
    targetId: key,
    proposalId,
    state: "blurred",
    reason: details.explanation,
    source: "automatic",
  })
  await insertReport({
    targetType: "attachment",
    targetId: key,
    proposalId,
    source: "automatic",
    reporterUserId: null,
    category: verdict ? categoryFor(verdict) : "other",
    severity: verdict?.severity ?? "medium",
    note: null,
    details,
  })
}

/** Check text once the response is sent; flag it for review if needed. */
export function flagText(a: {
  targetType: Extract<ModerationTarget, "proposal" | "comment">
  targetId: string
  proposalId: string
  text: string
}): void {
  if (!scanEnabled() || !a.text.trim()) return
  after(async () => {
    const outcome = await scanText(a.text, a.targetType)
    if (outcome.kind === "unavailable") return
    if (outcome.kind === "verdict" && outcome.verdict.decision === "allow") return
    const verdict = outcome.kind === "verdict" ? outcome.verdict : null
    await insertReport({
      targetType: a.targetType,
      targetId: a.targetId,
      proposalId: a.proposalId,
      source: "automatic",
      reporterUserId: null,
      category: verdict ? categoryFor(verdict) : "other",
      severity: verdict?.severity ?? "low",
      note: null,
      details: detailsOf(outcome),
    }).catch(() => null)
  })
}

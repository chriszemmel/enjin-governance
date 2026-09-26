/**
 * Automatic checks wired into the write paths (patch v1.5; settings v1.7).
 *
 *   checkUpload   runs before an image or PDF is stored: "block" rejects it
 *                 (or holds it, if admins chose that), "review" (or a
 *                 model refusal) stores it blurred and puts it in the
 *                 moderators' queue.
 *   flagText      runs after the response (next/server `after`) for
 *                 proposal text and comments; it can only add a queue
 *                 entry, never hide anything.
 *
 * What is checked, with which model and how many times a day comes from
 * the admin settings (settings-store.ts). An outage (timeout, server
 * error) never blocks posting - the item is handled as if checks were off.
 * An upload that can't be checked for a reason the uploader controls (too
 * long, animated, rejected as input) or after the daily limit waits for a
 * moderator instead, so nobody can force a file through unchecked.
 */

import "server-only"
import { after } from "next/server"
import { insertAction, insertReport, setState } from "@/lib/db/moderation"
import { env } from "@/lib/env"
import { notifyNewReport } from "./notify"
import { categoryFor, scanImage, scanPdf, scanText, type ScanOutcome } from "./scan"
import { noteScanUsage, reserveScan, scanPlan } from "./settings-store"
import type { ModerationTarget } from "./policy"

type UploadDecision =
  | { action: "store" }
  | { action: "store_blurred"; outcome: ScanOutcome }
  | { action: "reject"; message: string }

/** PDFs longer than this aren't sent; a moderator looks instead. */
const MAX_SCAN_PDF_PAGES = 30
const MAX_SCAN_PDF_BYTES = 5 * 1024 * 1024
/** Text is checked in pieces of this size (the text limit is 100,000). */
const TEXT_CHUNK = 60_000

/** Page objects in a PDF; 0 when they sit in compressed object streams. */
export function pdfPageEstimate(bytes: Buffer): number {
  return bytes.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0
}

const hold = (reason: string): UploadDecision => ({
  action: "store_blurred",
  outcome: { kind: "unavailable", reason },
})

/** A rejected request (not an outage): the input itself couldn't be checked. */
function inputRejected(outcome: ScanOutcome): boolean {
  if (outcome.kind !== "unavailable") return false
  const status = /^API (\d{3})$/.exec(outcome.reason)?.[1]
  return status != null && status.startsWith("4") && !["408", "409", "429"].includes(status)
}

export async function checkUpload(
  content:
    | { kind: "image"; jpeg: () => Promise<Buffer>; animated?: boolean }
    | { kind: "pdf"; bytes: Buffer },
  fileName: string,
): Promise<UploadDecision> {
  const kind = content.kind === "pdf" ? "pdfs" : "images"
  let plan: Awaited<ReturnType<typeof scanPlan>>
  try {
    plan = await scanPlan(kind)
  } catch {
    return { action: "store" }
  }
  if (!plan) return { action: "store" }

  // Only the first frame of an animation would be seen, and a very long
  // PDF costs a lot or is refused: a person looks at these instead.
  if (content.kind === "image" && content.animated) return hold("animated image")
  if (
    content.kind === "pdf" &&
    (content.bytes.length > MAX_SCAN_PDF_BYTES ||
      pdfPageEstimate(content.bytes) > MAX_SCAN_PDF_PAGES)
  ) {
    return hold("PDF too long to check automatically")
  }
  if (!(await reserveScan(kind, plan))) return hold("daily check limit reached")

  let outcome: ScanOutcome
  try {
    outcome =
      content.kind === "pdf"
        ? await scanPdf(content.bytes, { model: plan.model, fileName })
        : await scanImage(await content.jpeg(), { model: plan.model, fileName })
  } catch {
    return { action: "store" }
  }
  await noteScanUsage(kind, plan.model, outcome)
  if (outcome.kind === "refused" || inputRejected(outcome)) {
    return { action: "store_blurred", outcome }
  }
  if (outcome.kind !== "verdict") return { action: "store" }
  const v = outcome.verdict
  if (v.decision === "block") {
    if (plan.settings.onClearViolation === "hold") return { action: "store_blurred", outcome }
    return {
      action: "reject",
      message: `This file can't be published: ${v.explanation} If you think this is wrong, ask a moderator.`,
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
        explanation:
          outcome.kind === "refused"
            ? "The automatic check declined to classify this."
            : `Not checked automatically (${outcome.reason}); please review.`,
      }
}

const HELD_REASON = "Held for a moderator by the automatic check."

/**
 * Hold an upload for a moderator. Called before the file is stored, so it
 * is never served, not even for a moment; throws if the hold can't be
 * saved, and the upload must then be refused.
 */
export async function holdUpload(key: string, proposalId: string | null) {
  await setState({
    targetType: "attachment",
    targetId: key,
    proposalId,
    state: "blurred",
    // Public; the model's explanation stays in the report for moderators.
    reason: HELD_REASON,
    source: "automatic",
  })
}

/** Log a held upload publicly and put it in the moderators' queue. */
export async function reportHeldUpload(
  key: string,
  proposalId: string | null,
  outcome: ScanOutcome,
) {
  const details = detailsOf(outcome)
  const verdict = outcome.kind === "verdict" ? outcome.verdict : null
  // On the public log too, like every other state change.
  await insertAction({
    targetType: "attachment",
    targetId: key,
    proposalId,
    network: key.split("/")[1] ?? null,
    referendumIndex: null,
    action: "blur",
    reason: HELD_REASON,
    source: "automatic",
    actorPublicKey: null,
    actorLabel: "automatic check",
  })
  const category = verdict ? categoryFor(verdict) : "other"
  const severity = verdict?.severity ?? "medium"
  const created = await insertReport({
    targetType: "attachment",
    targetId: key,
    proposalId,
    source: "automatic",
    reporterUserId: null,
    category,
    severity,
    note: null,
    details,
  })
  if (created) {
    await notifyNewReport({
      targetId: key,
      targetType: "attachment",
      category,
      severity,
      source: "automatic",
      network: key.split("/")[1] ?? null,
      referendumIndex: null,
    })
  }
}

/** Check text once the response is sent; flag it for review if needed. */
export function flagText(a: {
  targetType: Extract<ModerationTarget, "proposal" | "comment">
  targetId: string
  proposalId: string
  text: string
}): void {
  // Cheap early exit; the settings are read inside `after`, off the
  // request's critical path.
  if (!env.ANTHROPIC_API_KEY || !a.text.trim()) return
  const kind = a.targetType === "proposal" ? "proposals" : "comments"
  after(async () => {
    const plan = await scanPlan(kind)
    if (!plan) return
    // Long text is checked piece by piece, so nothing hides past the end
    // of the first piece; the first piece that isn't fine is reported.
    let outcome: ScanOutcome | null = null
    for (let at = 0; at < a.text.length; at += TEXT_CHUNK) {
      if (!(await reserveScan(kind, plan))) return
      const piece = await scanText(a.text.slice(at, at + TEXT_CHUNK), a.targetType, {
        model: plan.model,
      })
      await noteScanUsage(kind, plan.model, piece)
      if (piece.kind === "unavailable") return
      if (piece.kind === "verdict" && piece.verdict.decision === "allow") continue
      outcome = piece
      break
    }
    if (!outcome) return
    const verdict = outcome.kind === "verdict" ? outcome.verdict : null
    const category = verdict ? categoryFor(verdict) : "other"
    const severity = verdict?.severity ?? "low"
    const created = await insertReport({
      targetType: a.targetType,
      targetId: a.targetId,
      proposalId: a.proposalId,
      source: "automatic",
      reporterUserId: null,
      category,
      severity,
      note: null,
      details: detailsOf(outcome),
    }).catch(() => false)
    if (created) {
      await notifyNewReport({
        targetId: a.targetId,
        targetType: a.targetType,
        category,
        severity,
        source: "automatic",
        network: null,
        referendumIndex: null,
      })
    }
  })
}

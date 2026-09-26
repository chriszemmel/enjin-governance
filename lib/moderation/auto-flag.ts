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
 * the admin settings (settings-store.ts). Scan failures never block
 * posting - the item is handled as if scanning were off.
 */

import "server-only"
import { after } from "next/server"
import { insertAction, insertReport, setState } from "@/lib/db/moderation"
import { env } from "@/lib/env"
import { notifyNewReport } from "./notify"
import { categoryFor, scanImage, scanPdf, scanText, type ScanOutcome } from "./scan"
import { noteScanUsage, scanPlan } from "./settings-store"
import type { ModerationTarget } from "./policy"

type UploadDecision =
  | { action: "store" }
  | { action: "store_blurred"; outcome: ScanOutcome }
  | { action: "reject"; message: string }

export async function checkUpload(
  content: { kind: "image"; jpeg: () => Promise<Buffer> } | { kind: "pdf"; bytes: Buffer },
  fileName: string,
): Promise<UploadDecision> {
  const kind = content.kind === "pdf" ? "pdfs" : "images"
  let outcome: ScanOutcome
  let plan: Awaited<ReturnType<typeof scanPlan>>
  try {
    plan = await scanPlan(kind)
    if (!plan) return { action: "store" }
    outcome =
      content.kind === "pdf"
        ? await scanPdf(content.bytes, { model: plan.model, fileName })
        : await scanImage(await content.jpeg(), { model: plan.model, fileName })
  } catch {
    return { action: "store" }
  }
  await noteScanUsage(kind, plan.model, outcome)
  if (outcome.kind === "refused") return { action: "store_blurred", outcome }
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
  // On the public log too, like every other state change.
  await insertAction({
    targetType: "attachment",
    targetId: key,
    proposalId,
    network: key.split("/")[1] ?? null,
    referendumIndex: null,
    action: "blur",
    reason: "Held for a moderator by the automatic check.",
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
    const outcome = await scanText(a.text, a.targetType, { model: plan.model })
    await noteScanUsage(kind, plan.model, outcome)
    if (outcome.kind === "unavailable") return
    if (outcome.kind === "verdict" && outcome.verdict.decision === "allow") return
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

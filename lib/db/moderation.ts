/**
 * Moderation tables (scripts/011_moderation.sql): roles, per-item state,
 * the public action log and reports.
 */

import "server-only"
import { getSql } from "./client"
import type {
  ModerationRole,
  ModerationStateValue,
  ModerationTarget,
  ReportCategory,
} from "@/lib/moderation/policy"

type Source = "moderator" | "proposer" | "automatic"

type ModerationStateRow = {
  target_type: ModerationTarget
  target_id: string
  proposal_id: string | null
  state: ModerationStateValue
  reason: string | null
  source: Source
  updated_at: Date
}

export type ModerationActionRow = {
  id: string
  target_type: ModerationTarget | "user" | "role"
  target_id: string
  proposal_id: string | null
  network: string | null
  referendum_index: number | null
  action: string
  reason: string
  source: Source
  actor_public_key: string | null
  actor_label: string | null
  created_at: Date
}

// ---- roles -------------------------------------------------------------------

export async function getGrantedRole(publicKey: string): Promise<ModerationRole | null> {
  const rows = (await getSql()`
    SELECT role FROM moderation_roles WHERE public_key = ${publicKey} LIMIT 1
  `) as { role: ModerationRole }[]
  return rows[0]?.role ?? null
}

export async function listRoles(): Promise<
  { public_key: string; role: ModerationRole; granted_by: string | null; created_at: Date }[]
> {
  return (await getSql()`
    SELECT public_key, role, granted_by, created_at FROM moderation_roles ORDER BY created_at ASC
  `) as { public_key: string; role: ModerationRole; granted_by: string | null; created_at: Date }[]
}

export async function grantRole(
  publicKey: string,
  role: ModerationRole,
  by: string,
): Promise<void> {
  await getSql()`
    INSERT INTO moderation_roles (public_key, role, granted_by)
    VALUES (${publicKey}, ${role}, ${by})
    ON CONFLICT (public_key) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by
  `
}

export async function revokeRole(publicKey: string): Promise<boolean> {
  const rows = (await getSql()`
    DELETE FROM moderation_roles WHERE public_key = ${publicKey} RETURNING public_key
  `) as unknown[]
  return rows.length > 0
}

// ---- state -------------------------------------------------------------------

export async function getState(
  targetType: ModerationTarget,
  targetId: string,
): Promise<ModerationStateRow | null> {
  const rows = (await getSql()`
    SELECT * FROM moderation_state
     WHERE target_type = ${targetType} AND target_id = ${targetId}
     LIMIT 1
  `) as ModerationStateRow[]
  return rows[0] ?? null
}

/**
 * Non-visible states of a proposal, its attachments and its comments.
 * Uploads checked before their draft existed carry no proposal_id, so
 * attachments are also matched by their folder.
 */
export async function listStatesForProposal(proposalId: string): Promise<ModerationStateRow[]> {
  const folder = `proposals/%/${proposalId}/media/%`
  return (await getSql()`
    SELECT * FROM moderation_state
     WHERE state <> 'visible'
       AND (proposal_id = ${proposalId}
            OR (target_type = 'attachment' AND target_id LIKE ${folder}))
  `) as ModerationStateRow[]
}

export async function setState(a: {
  targetType: ModerationTarget
  targetId: string
  proposalId: string | null
  state: ModerationStateValue
  reason: string
  source: Source
}): Promise<void> {
  await getSql()`
    INSERT INTO moderation_state (target_type, target_id, proposal_id, state, reason, source, updated_at)
    VALUES (${a.targetType}, ${a.targetId}, ${a.proposalId}, ${a.state}, ${a.reason}, ${a.source}, NOW())
    ON CONFLICT (target_type, target_id) DO UPDATE
      SET state = EXCLUDED.state,
          reason = EXCLUDED.reason,
          source = EXCLUDED.source,
          proposal_id = COALESCE(EXCLUDED.proposal_id, moderation_state.proposal_id),
          updated_at = NOW()
  `
}

// ---- public log ----------------------------------------------------------------

export async function insertAction(a: {
  targetType: ModerationActionRow["target_type"]
  targetId: string
  proposalId: string | null
  network: string | null
  referendumIndex: number | null
  action: string
  reason: string
  source: Source
  actorPublicKey: string | null
  actorLabel: string | null
}): Promise<void> {
  await getSql()`
    INSERT INTO moderation_actions (
      target_type, target_id, proposal_id, network, referendum_index,
      action, reason, source, actor_public_key, actor_label
    ) VALUES (
      ${a.targetType}, ${a.targetId}, ${a.proposalId}, ${a.network}, ${a.referendumIndex},
      ${a.action}, ${a.reason}, ${a.source}, ${a.actorPublicKey}, ${a.actorLabel}
    )
  `
}

export async function listActions(limit: number, before?: Date): Promise<ModerationActionRow[]> {
  const sql = getSql()
  return (
    before
      ? await sql`
          SELECT * FROM moderation_actions WHERE created_at < ${before}
           ORDER BY created_at DESC LIMIT ${limit}`
      : await sql`
          SELECT * FROM moderation_actions ORDER BY created_at DESC LIMIT ${limit}`
  ) as ModerationActionRow[]
}

// ---- reports -------------------------------------------------------------------

/** Returns false when this person already has an open report on the item. */
export async function insertReport(a: {
  targetType: ModerationTarget
  targetId: string
  proposalId: string | null
  source: "user" | "automatic"
  reporterUserId: string | null
  category: ReportCategory
  severity: "low" | "medium" | "high"
  note: string | null
  details: unknown
}): Promise<boolean> {
  const rows = (await getSql()`
    INSERT INTO moderation_reports (
      target_type, target_id, proposal_id, source, reporter_user_id,
      category, severity, note, details
    ) VALUES (
      ${a.targetType}, ${a.targetId}, ${a.proposalId}, ${a.source}, ${a.reporterUserId},
      ${a.category}, ${a.severity}, ${a.note}, ${a.details == null ? null : JSON.stringify(a.details)}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as unknown[]
  return rows.length > 0
}

export async function closeReports(
  targetType: ModerationTarget,
  targetId: string,
  status: "resolved" | "dismissed",
): Promise<void> {
  await getSql()`
    UPDATE moderation_reports
       SET status = ${status}, resolved_at = NOW()
     WHERE target_type = ${targetType} AND target_id = ${targetId} AND status = 'open'
  `
}

type QueueRow = {
  target_type: ModerationTarget
  target_id: string
  proposal_id: string | null
  reports: number
  user_reports: number
  automatic: boolean
  severity: "low" | "medium" | "high"
  categories: string[]
  notes: string[]
  details: unknown[]
  first_at: Date
  last_at: Date
  state: ModerationStateValue | null
  state_reason: string | null
  network: string | null
  referendum_index: number | null
  proposal_title: string | null
  proposer_address: string | null
  attachment_name: string | null
  attachment_type: string | null
  comment_body: string | null
  comment_author: string | null
}

/** Open reports grouped per item, most severe and oldest first. */
export async function listQueue(): Promise<QueueRow[]> {
  return (await getSql()`
    WITH open AS (
      SELECT target_type, target_id,
             MAX(proposal_id::text)::uuid AS proposal_id,
             COUNT(*)::int AS reports,
             COUNT(*) FILTER (WHERE source = 'user')::int AS user_reports,
             BOOL_OR(source = 'automatic') AS automatic,
             MAX(CASE severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) AS sev,
             ARRAY_AGG(DISTINCT category) AS categories,
             ARRAY_REMOVE(ARRAY_AGG(note ORDER BY created_at), NULL) AS notes,
             COALESCE(JSONB_AGG(details) FILTER (WHERE details IS NOT NULL), '[]'::jsonb) AS details,
             MIN(created_at) AS first_at,
             MAX(created_at) AS last_at
        FROM moderation_reports
       WHERE status = 'open'
       GROUP BY target_type, target_id
    )
    , located AS (
      -- Uploads checked before their draft existed have no proposal_id;
      -- their key names the proposal folder.
      SELECT open.*,
             COALESCE(
               open.proposal_id,
               CASE WHEN open.target_type = 'attachment'
                    THEN split_part(open.target_id, '/', 3)::uuid END
             ) AS pid
        FROM open
    )
    SELECT o.target_type, o.target_id, o.pid AS proposal_id, o.reports, o.user_reports, o.automatic,
           CASE o.sev WHEN 3 THEN 'high' WHEN 2 THEN 'medium' ELSE 'low' END AS severity,
           o.categories, o.notes, o.details, o.first_at, o.last_at,
           s.state, s.reason AS state_reason,
           p.network, p.referendum_index, p.title AS proposal_title, p.proposer_address,
           a.filename AS attachment_name, a.content_type AS attachment_type,
           LEFT(c.body_markdown, 400) AS comment_body, c.author_address AS comment_author
      FROM located o
      LEFT JOIN moderation_state s ON s.target_type = o.target_type AND s.target_id = o.target_id
      LEFT JOIN proposals p ON p.id = o.pid
      LEFT JOIN proposal_attachments a ON o.target_type = 'attachment' AND a.bucket_key = o.target_id
      LEFT JOIN comments c ON o.target_type = 'comment' AND c.id::text = o.target_id
     ORDER BY o.sev DESC, o.first_at ASC
     LIMIT 200
  `) as QueueRow[]
}

export async function queueStats(): Promise<{ open: number; auto_blurred_today: number }> {
  const rows = (await getSql()`
    SELECT
      (SELECT COUNT(*)::int FROM moderation_reports WHERE status = 'open') AS open,
      (SELECT COUNT(*)::int FROM moderation_state
        WHERE source = 'automatic' AND state = 'blurred'
          AND updated_at > NOW() - INTERVAL '1 day') AS auto_blurred_today
  `) as { open: number; auto_blurred_today: number }[]
  return rows[0] ?? { open: 0, auto_blurred_today: 0 }
}

// ---- posting suspension --------------------------------------------------------

/** When a wallet's posting pause ends, or null when it may post. */
export async function getSuspension(publicKey: string): Promise<Date | null> {
  const rows = (await getSql()`
    SELECT until FROM moderation_suspensions
     WHERE public_key = ${publicKey} AND until > NOW()
     LIMIT 1
  `) as { until: Date }[]
  return rows[0] ? new Date(rows[0].until) : null
}

export async function setSuspension(publicKey: string, until: Date | null, by: string): Promise<void> {
  const sql = getSql()
  if (!until) {
    await sql`DELETE FROM moderation_suspensions WHERE public_key = ${publicKey}`
    return
  }
  await sql`
    INSERT INTO moderation_suspensions (public_key, until, created_by)
    VALUES (${publicKey}, ${until}, ${by})
    ON CONFLICT (public_key) DO UPDATE SET until = EXCLUDED.until, created_by = EXCLUDED.created_by
  `
}

// ---- settings and scan usage (scripts/012_moderation_settings.sql) ------------

export async function getSetting(key: string): Promise<unknown> {
  const rows = (await getSql()`
    SELECT value FROM moderation_settings WHERE key = ${key} LIMIT 1
  `) as { value: unknown }[]
  return rows[0]?.value ?? null
}

export async function saveSetting(key: string, value: unknown, by: string): Promise<void> {
  await getSql()`
    INSERT INTO moderation_settings (key, value, updated_by, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}, ${by}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `
}

/** Count one check and its tokens against today (UTC). */
export async function recordScanUsage(a: {
  model: string
  kind: "images" | "pdfs" | "proposals" | "comments"
  inputTokens: number
  outputTokens: number
}): Promise<void> {
  await getSql()`
    INSERT INTO moderation_scan_usage (day, model, kind, checks, input_tokens, output_tokens)
    VALUES ((NOW() AT TIME ZONE 'UTC')::date, ${a.model}, ${a.kind}, 1, ${a.inputTokens}, ${a.outputTokens})
    ON CONFLICT (day, model, kind) DO UPDATE
      SET checks = moderation_scan_usage.checks + 1,
          input_tokens = moderation_scan_usage.input_tokens + EXCLUDED.input_tokens,
          output_tokens = moderation_scan_usage.output_tokens + EXCLUDED.output_tokens
  `
}

export async function scanChecksToday(): Promise<number> {
  const rows = (await getSql()`
    SELECT COALESCE(SUM(checks), 0)::int AS n FROM moderation_scan_usage
     WHERE day = (NOW() AT TIME ZONE 'UTC')::date
  `) as { n: number }[]
  return rows[0]?.n ?? 0
}

type ScanUsageRow = {
  model: string
  kind: string
  checks: number
  input_tokens: number
  output_tokens: number
}

/** Usage per model and kind since the first day of the current month (UTC). */
export async function scanUsageThisMonth(): Promise<ScanUsageRow[]> {
  return (await getSql()`
    SELECT model, kind,
           SUM(checks)::int AS checks,
           SUM(input_tokens)::float8 AS input_tokens,
           SUM(output_tokens)::float8 AS output_tokens
      FROM moderation_scan_usage
     WHERE day >= date_trunc('month', NOW() AT TIME ZONE 'UTC')::date
     GROUP BY model, kind
     ORDER BY model, kind
  `) as ScanUsageRow[]
}

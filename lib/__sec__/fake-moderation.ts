/**
 * In-memory stand-in for @/lib/db/moderation that mimics the tables from
 * scripts/011-012:
 *   - moderation_roles, moderation_suspensions keyed by public key
 *   - moderation_state PRIMARY KEY (target_type, target_id), upserted
 *   - moderation_actions is append-only; listActions newest first
 *   - moderation_reports: one open report per reporter per item and one
 *     open automatic flag per item (ON CONFLICT DO NOTHING -> false)
 *   - getSuspension only returns a pause that hasn't ended
 * `faults` makes a call throw, as when the database is down or a
 * migration hasn't been applied (use missingTable()).
 * claimSettingSlot keeps its slots in `slots` (key -> claimed at, ms), and
 * moderationSchema answers from `schema`.
 */
import type {
  ModerationRole,
  ModerationStateValue,
  ModerationTarget,
  ReportCategory,
} from "@/lib/moderation/policy"

type Source = "moderator" | "proposer" | "automatic"

export type StateRow = {
  target_type: ModerationTarget
  target_id: string
  proposal_id: string | null
  state: ModerationStateValue
  reason: string | null
  source: Source
  updated_at: Date
}

export type ActionRow = {
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

export type ReportRow = {
  target_type: ModerationTarget
  target_id: string
  proposal_id: string | null
  source: "user" | "automatic"
  reporter_user_id: string | null
  category: ReportCategory
  severity: "low" | "medium" | "high"
  note: string | null
  details: unknown
  status: "open" | "resolved" | "dismissed"
}

export const roles = new Map<
  string,
  { role: ModerationRole; granted_by: string | null; created_at: Date }
>()
export const states = new Map<string, StateRow>()
export const actions: ActionRow[] = []
export const reports: ReportRow[] = []
export const suspensions = new Map<string, Date>()
export const settings = new Map<string, unknown>()
/** Rows written with saveSetting, in order. */
export const settingWrites: { key: string; value: unknown }[] = []
export const slots = new Map<string, number>()
const LEDGER = [
  "011_moderation.sql",
  "012_moderation_settings.sql",
  "013_moderation_keep_state.sql",
  "014_drop_proposer_signature.sql",
]
/** What moderationSchema reports (migrations 011-013 and the ledger, which lists 014 too). */
export const schema = {
  moderation: true,
  settings: true,
  keepState: true,
  ledger: [...LEDGER] as string[] | null,
}
/** Scan checks reserved today, and whether the next reservation fits the limit. */
export const scanUsage = { reserved: 0, underLimit: true }
export const listActionsCalls: { limit: number; before?: Date }[] = []
/** What listQueue / queueStats return (the SQL aggregation isn't modelled). */
export const queue = {
  items: [] as unknown[],
  stats: { open: 0, auto_blurred_today: 0 },
}

type Fault = Error | null
export const faults = {
  roles: null as Fault,
  states: null as Fault,
  setState: null as Fault,
  actions: null as Fault,
  suspension: null as Fault,
  settings: null as Fault,
  slots: null as Fault,
  ping: null as Fault,
  schema: null as Fault,
  scanCount: null as Fault,
}
/** Runs inside setState before the row is written. */
export const hooks = { onSetState: null as null | ((row: StateRow) => void) }

let actionSeq = 0

export function resetModeration(): void {
  roles.clear()
  states.clear()
  actions.length = 0
  reports.length = 0
  suspensions.clear()
  settings.clear()
  settingWrites.length = 0
  slots.clear()
  schema.moderation = true
  schema.settings = true
  schema.keepState = true
  schema.ledger = [...LEDGER]
  scanUsage.reserved = 0
  scanUsage.underLimit = true
  listActionsCalls.length = 0
  queue.items = []
  queue.stats = { open: 0, auto_blurred_today: 0 }
  faults.roles = null
  faults.states = null
  faults.setState = null
  faults.actions = null
  faults.suspension = null
  faults.settings = null
  faults.slots = null
  faults.ping = null
  faults.schema = null
  faults.scanCount = null
  hooks.onSetState = null
  actionSeq = 0
}

/** Postgres "relation does not exist" (migration not applied). */
export function missingTable(): Error {
  return Object.assign(new Error('relation "moderation_state" does not exist'), { code: "42P01" })
}

export const stateKey = (targetType: string, targetId: string) => `${targetType}:${targetId}`

// ---- roles ---------------------------------------------------------------------

export async function getGrantedRole(publicKey: string): Promise<ModerationRole | null> {
  if (faults.roles) throw faults.roles
  return roles.get(publicKey)?.role ?? null
}

export async function listRoles() {
  if (faults.roles) throw faults.roles
  return [...roles.entries()]
    .map(([public_key, r]) => ({ public_key, ...r }))
    .sort((x, y) => x.created_at.getTime() - y.created_at.getTime())
}

export async function grantRole(publicKey: string, role: ModerationRole, by: string) {
  if (!/^0x[0-9a-f]{64}$/.test(publicKey)) {
    throw new Error(`new row violates check constraint "moderation_roles_key"`)
  }
  const existing = roles.get(publicKey)
  roles.set(publicKey, { role, granted_by: by, created_at: existing?.created_at ?? new Date() })
}

export async function revokeRole(publicKey: string): Promise<boolean> {
  return roles.delete(publicKey)
}

// ---- state ---------------------------------------------------------------------

export async function getState(targetType: ModerationTarget, targetId: string) {
  if (faults.states) throw faults.states
  return states.get(stateKey(targetType, targetId)) ?? null
}

export async function listStatesForProposal(proposalId: string): Promise<StateRow[]> {
  if (faults.states) throw faults.states
  return [...states.values()].filter(
    (s) =>
      s.state !== "visible" &&
      (s.proposal_id === proposalId ||
        (s.target_type === "attachment" &&
          new RegExp(`^proposals/[^/]+/${proposalId}/media/`).test(s.target_id))),
  )
}

export async function setState(a: {
  targetType: ModerationTarget
  targetId: string
  proposalId: string | null
  state: ModerationStateValue
  reason: string
  source: Source
}): Promise<void> {
  if (faults.setState) throw faults.setState
  const prev = states.get(stateKey(a.targetType, a.targetId))
  const row: StateRow = {
    target_type: a.targetType,
    target_id: a.targetId,
    proposal_id: a.proposalId ?? prev?.proposal_id ?? null,
    state: a.state,
    reason: a.reason,
    source: a.source,
    updated_at: new Date(),
  }
  hooks.onSetState?.(row)
  states.set(stateKey(a.targetType, a.targetId), row)
}

// ---- public log ----------------------------------------------------------------

export async function insertAction(a: {
  targetType: ActionRow["target_type"]
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
  actions.push({
    id: `00000000-0000-4000-a000-${String(++actionSeq).padStart(12, "0")}`,
    target_type: a.targetType,
    target_id: a.targetId,
    proposal_id: a.proposalId,
    network: a.network,
    referendum_index: a.referendumIndex,
    action: a.action,
    reason: a.reason,
    source: a.source,
    actor_public_key: a.actorPublicKey,
    actor_label: a.actorLabel,
    // Strictly increasing, so "newest first" is well defined.
    created_at: new Date(Date.UTC(2026, 0, 1) + actionSeq * 1000),
  })
}

export async function listActions(limit: number, before?: Date): Promise<ActionRow[]> {
  listActionsCalls.push({ limit, before })
  if (faults.actions) throw faults.actions
  return actions
    .filter((a) => !before || a.created_at < before)
    .sort((x, y) => y.created_at.getTime() - x.created_at.getTime())
    .slice(0, limit)
    .map((a) => ({ ...a }))
}

// ---- reports -------------------------------------------------------------------

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
  const clash = reports.some(
    (r) =>
      r.status === "open" &&
      r.target_type === a.targetType &&
      r.target_id === a.targetId &&
      ((a.reporterUserId != null && r.reporter_user_id === a.reporterUserId) ||
        (a.source === "automatic" && r.source === "automatic")),
  )
  if (clash) return false
  reports.push({
    target_type: a.targetType,
    target_id: a.targetId,
    proposal_id: a.proposalId,
    source: a.source,
    reporter_user_id: a.reporterUserId,
    category: a.category,
    severity: a.severity,
    note: a.note,
    details: a.details,
    status: "open",
  })
  return true
}

export async function openReportCount(targetType: ModerationTarget, targetId: string) {
  return reports.filter(
    (r) => r.status === "open" && r.target_type === targetType && r.target_id === targetId,
  ).length
}

export async function closeReports(
  targetType: ModerationTarget,
  targetId: string,
  status: "resolved" | "dismissed",
): Promise<void> {
  for (const r of reports) {
    if (r.status === "open" && r.target_type === targetType && r.target_id === targetId) {
      r.status = status
    }
  }
}

export async function listQueue() {
  return queue.items
}

export async function queueStats() {
  return queue.stats
}

// ---- posting suspension --------------------------------------------------------

export async function getSuspension(publicKey: string): Promise<Date | null> {
  if (faults.suspension) throw faults.suspension
  const until = suspensions.get(publicKey)
  return until && until.getTime() > Date.now() ? until : null
}

export async function setSuspension(publicKey: string, until: Date | null): Promise<void> {
  if (until) suspensions.set(publicKey, until)
  else suspensions.delete(publicKey)
}

// ---- settings and scan usage ---------------------------------------------------

export async function getSetting(key: string): Promise<unknown> {
  if (faults.settings) throw faults.settings
  return settings.get(key) ?? null
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  if (faults.settings) throw faults.settings
  settings.set(key, value)
  settingWrites.push({ key, value })
}

export async function claimSettingSlot(key: string, seconds: number): Promise<boolean> {
  if (faults.slots) throw faults.slots
  const last = slots.get(key)
  if (last !== undefined && Date.now() - last < seconds * 1000) return false
  slots.set(key, Date.now())
  return true
}

// ---- status checks -------------------------------------------------------------

export async function pingDatabase(): Promise<void> {
  if (faults.ping) throw faults.ping
}

export async function moderationSchema() {
  if (faults.schema) throw faults.schema
  return { ...schema, ledger: schema.ledger ? [...schema.ledger] : null }
}

export async function reserveScanCheck(): Promise<boolean> {
  if (faults.scanCount) throw faults.scanCount
  if (!scanUsage.underLimit) return false
  scanUsage.reserved += 1
  return true
}

export async function addScanTokens(): Promise<void> {}

export async function scanChecksToday(): Promise<number> {
  return scanUsage.reserved
}

export async function scanUsageThisMonth() {
  return []
}

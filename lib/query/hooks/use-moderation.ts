"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  ContentAction,
  ModerationRole,
  ModerationStateValue,
  ModerationTarget,
  ReportCategory,
} from "@/lib/moderation/policy"
import type { ScanSettings } from "@/lib/moderation/scan-settings"
import { readApiError } from "@/lib/utils/api-error"

export type ModerationInfo = {
  state: ModerationStateValue
  reason: string | null
  source: "moderator" | "proposer" | "automatic"
  updated_at: string
}

type ProposalModeration = {
  proposal: ModerationInfo | null
  /** By attachment bucket key. */
  attachments: Record<string, ModerationInfo>
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(await readApiError(res))
  return (await res.json()) as T
}

async function send<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return (await res.json()) as T
}

export function useMyModerationRole(enabled = true) {
  return useQuery<ModerationRole | null>({
    queryKey: ["moderation", "me"],
    queryFn: async () =>
      (await getJson<{ role: ModerationRole | null }>("/api/moderation/me")).role,
    enabled,
    staleTime: 60_000,
  })
}

export function useProposalModeration(proposalId: string | null | undefined) {
  return useQuery<ProposalModeration>({
    queryKey: ["moderation", "state", proposalId],
    queryFn: async () => {
      const { items } = await getJson<{
        items: (ModerationInfo & { target_type: ModerationTarget; target_id: string })[]
      }>(`/api/moderation/state?proposal=${proposalId}`)
      const out: ProposalModeration = { proposal: null, attachments: {} }
      for (const i of items) {
        const info = {
          state: i.state,
          reason: i.reason,
          source: i.source,
          updated_at: i.updated_at,
        }
        if (i.target_type === "proposal") out.proposal = info
        if (i.target_type === "attachment") out.attachments[i.target_id] = info
      }
      return out
    },
    enabled: !!proposalId,
    staleTime: 30_000,
  })
}

export function useReport() {
  return useMutation<
    { duplicate: boolean },
    Error,
    {
      target_type: ModerationTarget
      target_id: string
      category: ReportCategory
      note?: string | null
    }
  >({
    mutationFn: (body) => send("/api/moderation/reports", "POST", body),
  })
}

export type QueueItem = {
  target_type: ModerationTarget
  target_id: string
  proposal_id: string | null
  reports: number
  user_reports: number
  automatic: boolean
  severity: "low" | "medium" | "high"
  categories: string[]
  notes: string[]
  details: { labels?: string[]; explanation?: string; decision?: string }[]
  first_at: string
  last_at: string
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

export function useModerationQueue(enabled: boolean) {
  return useQuery<{
    role: ModerationRole
    items: QueueItem[]
    stats: { open: number; auto_blurred_today: number }
  }>({
    queryKey: ["moderation", "queue"],
    queryFn: () => getJson("/api/moderation/queue"),
    enabled,
    refetchInterval: 30_000,
  })
}

export function useModerationAction() {
  const qc = useQueryClient()
  return useMutation<
    unknown,
    Error,
    | { target_type: ModerationTarget; target_id: string; action: ContentAction; reason: string }
    | {
        target_type: "user"
        target_id: string
        action: "suspend" | "unsuspend"
        days?: number
        reason: string
      }
  >({
    mutationFn: (body) => send("/api/moderation/actions", "POST", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["moderation"] }),
  })
}

export type LogItem = {
  id: string
  target_type: string
  network: string | null
  referendum_index: number | null
  action: string
  reason: string
  source: "moderator" | "proposer" | "automatic"
  actor: string | null
  created_at: string
}

export function useModerationLog() {
  return useQuery<LogItem[]>({
    queryKey: ["moderation", "log"],
    queryFn: async () => (await getJson<{ items: LogItem[] }>("/api/moderation/log")).items,
    staleTime: 30_000,
  })
}

type RoleItem = {
  public_key: string
  role: ModerationRole
  fixed: boolean
  created_at: string | null
}

export function useModerationRoles(enabled: boolean) {
  return useQuery<RoleItem[]>({
    queryKey: ["moderation", "roles"],
    queryFn: async () => (await getJson<{ items: RoleItem[] }>("/api/moderation/roles")).items,
    enabled,
  })
}

export function useSetRole() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, { address: string; role: ModerationRole | null }>({
    mutationFn: ({ address, role }) =>
      role
        ? send("/api/moderation/roles", "POST", { address, role })
        : send("/api/moderation/roles", "DELETE", { address }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["moderation", "roles"] }),
  })
}

type ScanSettingsResponse = {
  settings: ScanSettings
  api_key_configured: boolean
  checks_today: number | null
  month:
    | {
        model: string
        kind: string
        checks: number
        input_tokens: number
        output_tokens: number
        cost_usd: number
      }[]
    | null
}

export function useScanSettings(enabled: boolean) {
  return useQuery<ScanSettingsResponse>({
    queryKey: ["moderation", "settings"],
    queryFn: () => getJson("/api/moderation/settings"),
    enabled,
  })
}

export function useSaveScanSettings() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, ScanSettings>({
    mutationFn: (settings) => send("/api/moderation/settings", "PUT", settings),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["moderation", "settings"] }),
  })
}

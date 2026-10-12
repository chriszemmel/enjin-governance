"use client"

import { useQuery } from "@tanstack/react-query"
import type { ChainConfig } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { type EnactmentState, enactmentStateFrom } from "@/lib/governance/lifecycle"
import {
  type EnactmentRecord,
  readEnactmentRecord,
  readEnactmentTask,
  type TaskAddress,
} from "@/lib/governance/scheduler"
import type { Referendum } from "@/lib/governance/types"
import { useApi } from "./use-api"
import { useArchiveApi } from "./use-archive-api"

/**
 * `scheduler.lookup` of referendum `index`'s enactment task: where its call
 * waits to run, or null once it has run (or when there is none). Re-read
 * every 30s while the task is waiting, so the page notices it ran.
 */
function useEnactmentTask(
  index: number | null,
  options: { enabled?: boolean; chain?: ChainConfig } = {},
) {
  const active = useActiveChain()
  const target = options.chain ?? active
  const apiQuery = useApi(target)
  return useQuery<TaskAddress | null>({
    queryKey: ["enactment-task", target.id, index],
    queryFn: () => {
      if (!apiQuery.data || index == null) throw new Error("API not ready")
      return readEnactmentTask(apiQuery.data, index)
    },
    enabled: apiQuery.isSuccess && index != null && (options.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: (query) => (query.state.data ? 30_000 : false),
  })
}

/**
 * How referendum `index`'s enactment ran, from the archive (see
 * `readEnactmentRecord`). Only meaningful once its task has left the
 * scheduler. A record is final, so it is kept; a null (the archive not
 * there yet) is retried.
 */
function useEnactmentRecord(
  index: number | null,
  approvalBlock: number | null,
  options: { enabled?: boolean; chain?: ChainConfig } = {},
) {
  const active = useActiveChain()
  const target = options.chain ?? active
  const apiQuery = useArchiveApi(target)
  return useQuery<EnactmentRecord | null>({
    queryKey: ["enactment-record", target.id, index, approvalBlock],
    queryFn: () => {
      if (!apiQuery.data || index == null || approvalBlock == null) {
        throw new Error("API not ready")
      }
      return readEnactmentRecord(apiQuery.data, index, approvalBlock)
    },
    enabled:
      apiQuery.isSuccess && index != null && approvalBlock != null && (options.enabled ?? true),
    staleTime: Infinity,
    refetchInterval: (query) => (query.state.data === null ? 30_000 : false),
  })
}

/**
 * The scheduler's view of an Approved referendum's enactment, for
 * `getLifecycle`. Undefined for any other status. With `withRecord` the
 * executed block and result are recovered from the archive (the detail
 * page); without it (cards) only the lookup is read.
 */
export function useEnactment(
  referendum: Referendum,
  options: { withRecord?: boolean; chain?: ChainConfig } = {},
): { state: EnactmentState | undefined; record: EnactmentRecord | null | undefined } {
  const approvalBlock = referendum.status.type === "Approved" ? referendum.status.at : null
  const taskQuery = useEnactmentTask(referendum.index, {
    enabled: approvalBlock != null,
    chain: options.chain,
  })
  const executed = approvalBlock != null && taskQuery.isSuccess && taskQuery.data === null
  const recordQuery = useEnactmentRecord(referendum.index, approvalBlock, {
    enabled: executed && (options.withRecord ?? false),
    chain: options.chain,
  })
  // Undefined while loading, null when the archive couldn't tell.
  const record = !executed
    ? undefined
    : recordQuery.isSuccess
      ? recordQuery.data
      : recordQuery.isError
        ? null
        : undefined

  if (approvalBlock == null) return { state: undefined, record: undefined }
  return { state: enactmentStateFrom(taskQuery.data, record), record }
}

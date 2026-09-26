"use client"

import { useMemo } from "react"
import type { ApiPromise } from "@polkadot/api"
import { blake2AsHex } from "@polkadot/util-crypto"
import { Info } from "lucide-react"
import { useApi } from "@/lib/query/hooks/use-api"

/**
 * For runtime upgrades: the blake2-256 of the proposed runtime, computed
 * from the preimage on chain (not from anything the proposer wrote), so
 * voters can compare it with the srtool build hash of the release.
 */
export function RuntimeCodeHash({ callBytes }: { callBytes: Uint8Array | null | undefined }) {
  const apiQuery = useApi()
  const codeHash = useMemo(() => {
    const api = apiQuery.data as ApiPromise | undefined
    if (!api || !callBytes) return null
    try {
      const call = api.createType("Call", callBytes) as unknown as {
        section: string
        method: string
        args: { toU8a(bare?: boolean): Uint8Array }[]
      }
      if (call.section !== "system") return null
      if (call.method !== "setCode" && call.method !== "setCodeWithoutChecks") return null
      const code = call.args[0]?.toU8a(true)
      return code ? { hash: blake2AsHex(code, 256), size: code.length } : null
    } catch {
      return null
    }
  }, [apiQuery.data, callBytes])

  if (!codeHash) return null
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-1 p-3 space-y-1.5">
      <p className="text-xs font-medium text-foreground">Runtime code</p>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Code hash</dt>
        <dd className="font-mono text-foreground break-all">{codeHash.hash}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd className="font-mono text-foreground">{codeHash.size.toLocaleString("en-US")} bytes</dd>
      </dl>
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
        Computed from the preimage on chain. Compare it with the srtool build hash in the release
        notes before voting.
      </p>
    </div>
  )
}

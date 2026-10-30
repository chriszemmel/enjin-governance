"use client"

import { Info } from "lucide-react"
import type { RuntimeCode } from "@/lib/governance/runtime-code"

/**
 * For runtime upgrades: the blake2-256 of the proposed runtime, read from
 * the call on chain (not from anything the proposer wrote), so voters can
 * compare it with the srtool build hash of the release. A `setCode` call
 * carries the wasm, so its hash is computed; an `authorizeUpgrade` call
 * carries the hash itself.
 */
export function RuntimeCodeHash({ code }: { code: RuntimeCode | null | undefined }) {
  if (!code) return null
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-1 p-3 space-y-1.5">
      <p className="text-xs font-medium text-foreground">
        {code.via === "authorizeUpgrade" ? "Authorized runtime" : "Runtime code"}
      </p>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Code hash</dt>
        <dd className="font-mono text-foreground break-all">{code.hash}</dd>
        {code.size != null && (
          <>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="font-mono text-foreground">{code.size.toLocaleString("en-US")} bytes</dd>
          </>
        )}
      </dl>
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
        {code.via === "authorizeUpgrade"
          ? "Once enacted, only a wasm with this hash can be applied (system.applyAuthorizedUpgrade). Compare it with the srtool build hash in the release notes before voting."
          : "Computed from the preimage on chain. Compare it with the srtool build hash in the release notes before voting."}
      </p>
    </div>
  )
}

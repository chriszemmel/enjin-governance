"use client"

import { Check, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { CallCard, type CallStatus } from "@/components/create/call-card"
import { Row, TxHashLine } from "./create-ui"

type SignProps = {
  chainName: string
  /** Builder for the Subscan extrinsic URL - null when this chain has no Subscan deep link. */
  subscanTxUrl: (txHash: string) => string | null
  calls: {
    title: string
    pallet: string
    method: string
    summary: string
    details: { label: string; value: React.ReactNode }[]
    rawPayload?: string
  }[]
  callStatus: CallStatus[]
  txStatus: { kind: string; message?: string; txHash?: string; blockHash?: string }
  submittedIndex: number | null
  confirming: boolean
  referendumLink: string | null
  jsonUrl: string
  /** Optional action (e.g. place decision deposit) shown on success. */
  decisionDepositSlot?: React.ReactNode
}

export function SignAndDone(p: SignProps) {
  const phaseLabel = (() => {
    if (p.txStatus.kind === "finalized") return "Finalised"
    switch (p.txStatus.kind) {
      case "idle":
        return "Ready to sign"
      case "signing":
        return "Waiting for wallet signature…"
      case "broadcast":
        return "Broadcasting to network…"
      case "in-block":
        return "Included in block - awaiting finalisation"
      case "finalized":
        return "Finalised"
      case "error":
        return p.txStatus.message ?? "Failed"
      default:
        return ""
    }
  })()

  return (
    <div className="space-y-5">
      <div
        className={cn(
          "rounded-2xl border p-5",
          p.txStatus.kind === "finalized"
            ? "bg-emerald-500/5 border-emerald-500/30"
            : "bg-card border-primary/40",
        )}
      >
        <div className="flex items-center gap-3">
          {p.txStatus.kind === "finalized" ? (
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <Check className="w-5 h-5 text-emerald-400" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">{phaseLabel}</p>
            {p.txStatus.txHash && (
              <TxHashLine
                txHash={p.txStatus.txHash}
                url={p.subscanTxUrl(p.txStatus.txHash)}
              />
            )}
            {p.confirming && (
              <p className="text-[11px] text-muted-foreground">
                Updating database…
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-card border border-border p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Progress</h2>
        {p.calls.map((c, i) => (
          <CallCard
            key={`${c.pallet}.${c.method}`}
            index={i}
            status={p.callStatus[i] ?? "pending"}
            title={c.title}
            pallet={c.pallet}
            method={c.method}
            summary={c.summary}
            details={c.details}
            rawPayload={c.rawPayload}
          />
        ))}
      </div>

      {p.txStatus.kind === "finalized" && (
        <div className="rounded-2xl bg-card border border-border p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">On-chain result</h2>
          <Row label="Network">{p.chainName}</Row>
          <Row label="Referendum">
            {p.submittedIndex != null ? (
              <span className="font-mono text-foreground">#{p.submittedIndex}</span>
            ) : (
              <span className="text-muted-foreground">no index in events</span>
            )}
          </Row>
          <Row label="JSON URL">
            <a
              href={p.jsonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-purple-dim font-mono text-xs break-all inline-flex items-center gap-1"
            >
              {p.jsonUrl}
              <ExternalLink className="w-3 h-3" />
            </a>
          </Row>
          {p.referendumLink && (
            <Row label="Subscan">
              <a
                href={p.referendumLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-purple-dim inline-flex items-center gap-1"
              >
                Open
                <ExternalLink className="w-3 h-3" />
              </a>
            </Row>
          )}

          {p.decisionDepositSlot != null && p.submittedIndex != null && (
            <div className="pt-3 mt-1 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your referendum is filed but won&apos;t enter the deciding phase
                until its decision deposit is placed. Start the clock now:
              </p>
              {p.decisionDepositSlot}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

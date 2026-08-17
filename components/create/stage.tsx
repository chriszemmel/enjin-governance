"use client"

import {
  AlertCircle,
  Check,
  Cloud,
  Database,
  ExternalLink,
  FileJson,
} from "lucide-react"
import { CallCard } from "@/components/create/call-card"
import type { UploadedAttachment } from "@/components/create/attachment-dropzone"
import {
  ArtefactRow,
  CopyableMono,
  Row,
  formatPlanckShort,
  type DraftResponse,
} from "./create-ui"

type StageProps = {
  draft: DraftResponse
  title: string
  summary: string
  body: string
  amountFormatted: string
  amountPlanck: bigint
  beneficiary: string
  beneficiaryName: string | null
  track: string
  trackRaw: string
  chainName: string
  attachments: UploadedAttachment[]
  callHex: string
  preimageHash: string
  preimageLen: number
  preimageAlreadyNoted: boolean
  metadataHash: string | null
  decisionDeposit: bigint | null
  chainTicker: string
  chainDecimals: number
}

export function Stage(p: StageProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/30 p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <Check className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 flex-wrap">
              Proposal saved
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 text-[10px] font-mono uppercase tracking-wider">
                EGOV1
              </span>
            </h2>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              Your proposal is stored on the EGOV1 open standard so anyone can
              verify it later. Nothing has been broadcast yet - review the
              steps below, then sign.
            </p>
          </div>
        </div>

        <details className="mt-4 group">
          <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Show technical details
          </summary>
          <div className="mt-3 space-y-3">
            <ArtefactRow
              icon={<Cloud className="w-4 h-4 text-emerald-400" />}
              label="Storage"
            >
              <div className="space-y-1">
                <a
                  href={p.draft.json_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:text-purple-dim font-mono text-xs break-all"
                >
                  {p.draft.json_url}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
                <CopyableMono label="sha256" value={p.draft.json_sha256} />
                <p className="text-[11px] text-muted-foreground font-mono">
                  {p.draft.json_size_bytes} bytes
                </p>
              </div>
            </ArtefactRow>

            <ArtefactRow
              icon={<Database className="w-4 h-4 text-emerald-400" />}
              label="Database row"
            >
              <CopyableMono label="proposal id" value={p.draft.id} />
              <p className="text-[11px] text-muted-foreground mt-1">
                status: <span className="text-foreground">draft</span> · attachments:{" "}
                <span className="text-foreground">{p.attachments.length}</span>
              </p>
            </ArtefactRow>

            <ArtefactRow
              icon={<FileJson className="w-4 h-4 text-emerald-400" />}
              label="JSON schema"
            >
              <p className="text-[11px] font-mono text-muted-foreground">
                EGOV1 · enjin-governance-proposal v1.0.0
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Open the URL above to inspect the stored proposal. The
                sha256 listed is what we&apos;ll commit into the on-chain
                metadata envelope.
              </p>
            </ArtefactRow>
          </div>
        </details>
      </div>

      <div className="rounded-2xl bg-card border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">
          What you&apos;ll sign
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {p.preimageAlreadyNoted
            ? "One signature covers the three remaining steps. The proposal content was already registered on chain by an earlier identical submission - we'll re-use it."
            : "One signature covers all four steps. If any of them fails, none apply."}
        </p>

        <CallCard
          index={0}
          status={p.preimageAlreadyNoted ? "ok" : "pending"}
          title="Register the proposal content"
          pallet="preimage"
          method="notePreimage"
          summary={
            p.preimageAlreadyNoted
              ? "Already noted on chain - this step will be skipped. The referendum will reference the existing preimage by hash."
              : "Stores the call bytes on chain so the referendum has something to enact when it passes."
          }
          details={[
            { label: "Preimage hash", value: p.preimageHash },
            { label: "Length (bytes)", value: String(p.preimageLen) },
          ]}
          rawPayload={p.callHex}
        />
        <CallCard
          index={1}
          status="pending"
          title={`File the referendum on ${p.track}`}
          pallet="referenda"
          method="submit"
          summary={`Opens voting on the ${p.track} track. Enacts the moment it's approved.`}
          details={[
            { label: "Origin", value: `Origins.${p.trackRaw}` },
            { label: "Lookup hash", value: p.preimageHash },
            { label: "Lookup len", value: String(p.preimageLen) },
            { label: "Enactment", value: "After 0 blocks" },
          ]}
        />
        <CallCard
          index={2}
          status="pending"
          title="Register the EGOV1 metadata envelope"
          pallet="preimage"
          method="notePreimage"
          summary="Stores the pointer to the off-chain proposal on chain so anyone can fetch and verify it."
          details={[
            { label: "Standard", value: "EGOV1" },
            { label: "JSON URL", value: p.draft.json_url },
            { label: "sha256", value: p.draft.json_sha256 },
          ]}
          rawPayload={p.draft.remark_payload}
        />
        <CallCard
          index={3}
          status="pending"
          title="Bind the metadata to the referendum"
          pallet="referenda"
          method="setMetadata"
          summary="Points the referendum at the envelope so wallets, explorers, and indexers resolve it natively. Targets the index the submission above is assigned."
          details={[
            { label: "Metadata hash", value: p.metadataHash ?? "-" },
          ]}
        />
      </div>

      <div className="rounded-xl bg-amber-500/5 border border-amber-500/30 p-4 text-xs text-muted-foreground leading-relaxed flex gap-3">
        <AlertCircle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p>
            A submission deposit is reserved on chain at submit time, refunded
            when the referendum is decided. The decision deposit for the{" "}
            <span className="text-primary">{p.track}</span> track
            {p.decisionDeposit != null && (
              <>
                {" "}- currently{" "}
                <span className="font-mono text-foreground">
                  {formatPlanckShort(p.decisionDeposit, p.chainDecimals, p.chainTicker)}
                </span>
              </>
            )}{" "}
            must be placed before deciding starts. Anyone can place it.
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-card border border-border p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Summary</h2>
        <Row label="Network">{p.chainName}</Row>
        <Row label="Title">{p.title}</Row>
        <Row label="Summary">{p.summary}</Row>
        <Row label="Beneficiary">
          <span className="block">
            {p.beneficiaryName && (
              <span className="text-foreground font-medium">
                {p.beneficiaryName}
              </span>
            )}
            <span className="block font-mono text-xs text-muted-foreground break-all mt-1">
              {p.beneficiary}
            </span>
          </span>
        </Row>
        <Row label="Requesting">{p.amountFormatted}</Row>
        <Row label="Track">
          <span className="font-mono">{p.track}</span>
        </Row>
        <Row label="Attachments">
          {p.attachments.length === 0 ? "none" : `${p.attachments.length} file(s)`}
        </Row>
      </div>
    </div>
  )
}

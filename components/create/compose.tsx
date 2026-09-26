"use client"

import { useMemo, useRef } from "react"
import { Hash } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatTrackName } from "@/lib/governance/display"
import {
  ENJIN_TREASURY_TIERS,
  type pickOriginForAmount,
} from "@/lib/governance/treasury"
import {
  AttachmentDropzone,
  type UploadedAttachment,
} from "@/components/create/attachment-dropzone"
import type { EnactmentChoice } from "@/lib/governance/enactment"
import type { AddressInspection } from "@/lib/chain/ss58"
import { MyDraftsPanel } from "@/components/create/my-drafts-panel"
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@/components/create/markdown-editor"
import {
  markdownForAttachment,
  resolveProposalMedia,
} from "@/lib/governance/proposal-media"
import { BeneficiaryCard } from "./beneficiary-card"
import { EnactmentField } from "./enactment-field"
import { Field } from "./create-ui"

type ComposeProps = {
  isConnected: boolean
  balanceFree: bigint | null
  /** Connected signer - proposer of record (drafts, deposits, sign-in). */
  proposerAddress: string | null
  /** Resolved payout address (defaults to proposer when the field is empty). */
  beneficiary: string | null
  /** Raw text in the beneficiary field ("" = pay self). */
  beneficiaryInput: string
  /** What the field holds - see inspectAddress. */
  beneficiaryStatus: AddressInspection["status"]
  /** Network name when the field holds another network's address format. */
  beneficiaryNetworkLabel: string | null
  beneficiaryIsSelf: boolean
  accountName: string | null
  chainShort: string
  chainTicker: string
  chainDecimals: number
  title: string
  summary: string
  body: string
  amount: string
  amountError: string | null
  pickedTier: ReturnType<typeof pickOriginForAmount>
  requiredPlanck: bigint | null
  balanceSufficient: boolean
  proposalId: string
  network: "enjin-relay" | "enjin-matrix" | "canary-relay" | "canary-matrix"
  attachments: UploadedAttachment[]
  onAttachmentsChange: (v: UploadedAttachment[]) => void
  beforeUpload?: (opts?: { fresh?: boolean }) => Promise<boolean>
  enactment: EnactmentChoice
  enactmentError: string | null
  minEnactment: number | null
  onTitle: (v: string) => void
  onSummary: (v: string) => void
  onBody: (v: string) => void
  onAmount: (v: string) => void
  onBeneficiary: (v: string) => void
  onEnactment: (v: EnactmentChoice) => void
  onConnect: () => void
}

export function Compose(p: ComposeProps) {
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const media = useMemo(
    () => resolveProposalMedia(p.attachments, p.network, p.proposalId),
    [p.attachments, p.network, p.proposalId],
  )
  return (
    <div className="space-y-5">
      <MyDraftsPanel
        address={p.proposerAddress}
        network={p.network}
        ensureSignedIn={p.beforeUpload}
      />
      <BeneficiaryCard
        isConnected={p.isConnected}
        accountName={p.accountName}
        address={p.proposerAddress}
        chainShortName={p.chainShort}
        balanceFree={p.balanceFree}
        requiredPlanck={p.requiredPlanck}
        balanceSufficient={p.balanceSufficient}
        chainTicker={p.chainTicker}
        chainDecimals={p.chainDecimals}
        onConnect={p.onConnect}
      />

      <h2 className="text-sm font-semibold text-foreground">Proposal</h2>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          Beneficiary address
        </label>
        <input
          type="text"
          value={p.beneficiaryInput}
          onChange={(e) => p.onBeneficiary(e.target.value)}
          placeholder={p.proposerAddress ?? "Defaults to your connected wallet"}
          disabled={!p.isConnected}
          spellCheck={false}
          className={cn(
            "w-full px-4 py-3 rounded-xl bg-surface-1 border text-sm text-foreground font-mono focus:outline-none focus:ring-1 transition-all disabled:opacity-50",
            p.beneficiaryStatus === "invalid"
              ? "border-destructive/50 focus:border-destructive focus:ring-destructive/30"
              : p.beneficiaryStatus === "foreign"
                ? "border-amber-500/50 focus:border-amber-500 focus:ring-amber-500/30"
                : "border-border focus:border-primary/50 focus:ring-primary/20",
          )}
        />
        <BeneficiaryHint
          status={p.beneficiaryStatus}
          networkLabel={p.beneficiaryNetworkLabel}
          isSelf={p.beneficiaryIsSelf}
          chainShort={p.chainShort}
        />
      </div>

      <Field
        label="Title"
        required
        value={p.title}
        onChange={p.onTitle}
        placeholder="Clear, descriptive title (≥ 10 chars)"
        maxLength={200}
        hint={`${p.title.length}/200 characters`}
        disabled={!p.isConnected}
      />

      <Field
        label="Summary"
        required
        value={p.summary}
        onChange={p.onSummary}
        placeholder="1-3 sentences. Appears in list views."
        multiline
        rows={3}
        maxLength={500}
        hint={`${p.summary.length}/500 · ≥ 20 chars required`}
        disabled={!p.isConnected}
      />

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          Requested amount ({p.chainTicker}) <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={p.amount}
          onChange={(e) => p.onAmount(e.target.value)}
          placeholder="e.g. 1000"
          disabled={!p.isConnected}
          className={cn(
            "w-full px-4 py-3 rounded-xl bg-surface-1 border text-sm text-foreground font-mono focus:outline-none focus:ring-1 transition-all disabled:opacity-50",
            p.amountError
              ? "border-destructive/50 focus:border-destructive focus:ring-destructive/30"
              : "border-border focus:border-primary/50 focus:ring-primary/20",
          )}
        />
        {p.amountError ? (
          <p className="text-[11px] text-destructive">{p.amountError}</p>
        ) : p.pickedTier ? (
          <p className="text-[11px] text-muted-foreground">
            Will submit on the{" "}
            <span className="text-primary">{formatTrackName(p.pickedTier.origin)}</span> track
            (smallest tier that fits).
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            The smallest treasury track that covers this amount will be chosen automatically.
          </p>
        )}
      </div>

      <MarkdownEditor
        ref={editorRef}
        label="Full proposal"
        required
        value={p.body}
        onChange={p.onBody}
        placeholder="Motivation, specification, milestones, risks, reporting cadence. Markdown supported."
        rows={12}
        maxLength={100_000}
        hint={`${p.body.length.toLocaleString("en-US")}/100,000 · ≥ 50 chars required · markdown`}
        disabled={!p.isConnected}
        media={media}
      />

      <EnactmentField
        value={p.enactment}
        error={p.enactmentError}
        minEnactment={p.minEnactment}
        disabled={!p.isConnected}
        onChange={p.onEnactment}
      />

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Attachments (optional)</h3>
        <p className="text-[11px] text-muted-foreground">
          Uploaded to off-chain storage before the on-chain transaction.
        </p>
        <AttachmentDropzone
          proposalId={p.proposalId}
          network={p.network}
          attachments={p.attachments}
          onChange={p.onAttachmentsChange}
          beforeUpload={p.beforeUpload}
          disabled={!p.isConnected}
          deleteOnRemove
          onInsert={(att) =>
            editorRef.current?.insert(markdownForAttachment(att), {
              block: att.content_type.startsWith("image/"),
            })
          }
        />
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground transition-colors flex items-center gap-1.5">
          <Hash className="w-3 h-3" />
          Treasury tier reference
        </summary>
        <ul className="mt-3 space-y-1.5 font-mono pl-5">
          {ENJIN_TREASURY_TIERS.map((t) => (
            <li key={t.origin} className="flex justify-between">
              <span className="text-foreground">{formatTrackName(t.origin)}</span>
              <span>
                ≤{" "}
                {t.maxAmount == null
                  ? "∞"
                  : `${(t.maxAmount / 10n ** BigInt(p.chainDecimals)).toString()} ${p.chainTicker}`}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function BeneficiaryHint({
  status,
  networkLabel,
  isSelf,
  chainShort,
}: {
  status: AddressInspection["status"]
  networkLabel: string | null
  isSelf: boolean
  chainShort: string
}) {
  if (status === "invalid") {
    return (
      <p className="text-[11px] text-destructive">Not a valid address for {chainShort}.</p>
    )
  }
  if (status === "foreign") {
    return (
      <p className="text-[11px] text-amber-600 dark:text-amber-400">
        {networkLabel === "raw public key" ? "Raw public key" : `${networkLabel} address`}.
        Convert it to {chainShort} format before staging.
      </p>
    )
  }
  if (status === "empty") {
    return (
      <p className="text-[11px] text-muted-foreground">
        Treasury payout goes to your connected wallet. Enter another address to pay someone
        else.
      </p>
    )
  }
  return isSelf ? (
    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
      {chainShort} address - this is your connected wallet.
    </p>
  ) : (
    <p className="text-[11px] text-muted-foreground">
      Treasury payout goes to this address - not your wallet. Double-check it.
    </p>
  )
}

"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { Coins, Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { formatTokenAmount } from "@/lib/chain/format"
import {
  depositHold,
  type DepositKind,
  type ProposalRecordRef,
} from "@/lib/governance/deposits"
import { buildUnnotePreimage } from "@/lib/governance/preimage"
import {
  buildRefundDecisionDeposit,
  buildRefundSubmissionDeposit,
} from "@/lib/governance/referenda"
import { useReservedDeposits } from "@/lib/query/hooks/use-reserved-deposits"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { WalletModal } from "@/components/wallet/wallet-modal"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type ActiveAction =
  | { type: "unnote"; key: string; hash: `0x${string}` }
  | { type: "refund"; key: string; index: number; kind: DepositKind }

/** A proposal-record preimage the user asked to unnote, awaiting confirmation. */
type PendingRecordUnnote = {
  key: string
  hash: `0x${string}`
  amount: bigint
  record: ProposalRecordRef
}

/**
 * Shows the governance deposits the connected address has tied up on chain
 * (referendum submission/decision + noted-preimage deposits) and offers
 * one-click reclaim. This is the "where did my reserved ENJ go?" answer -
 * reserved balance that conviction-unlock never touches.
 *
 * Both reclaim extrinsics (refund deposit / un-note preimage) plus the sign
 * modal and the wallet-connect prompt live at panel level, not inside a row.
 * Reclaiming removes the item from the list, and the deposits query refetches
 * on window focus (returning from the wallet app), so a modal rendered inside
 * the row would unmount mid-success. At panel level it survives until the user
 * dismisses it.
 *
 * A preimage that holds a proposal's on-chain record (its EGOV1 envelope /
 * `MetadataOf` target) is reclaimable as far as the runtime is concerned,
 * but unnoting it leaves the proposal unreadable from chain - so its row
 * says what it's for and the reclaim goes through a confirmation first.
 */
export function ReservedDepositsPanel({ address }: { address: string }) {
  const chain = useActiveChain()
  const queryClient = useQueryClient()
  const query = useReservedDeposits(address)
  const data = query.data

  const { status: walletStatus, session: walletSession } = useWallet()
  const isConnected = walletStatus === "connected"
  const [walletOpen, setWalletOpen] = useState(false)
  const sign = useSignFlow()
  const walletMeta = walletDisplayFor(walletSession ?? null)
  const [active, setActive] = useState<ActiveAction | null>(null)
  const activeRef = useRef<ActiveAction | null>(null)
  const [pendingRecord, setPendingRecord] = useState<PendingRecordUnnote | null>(null)

  const tx = useExtrinsic({
    build: (api) => {
      const a = activeRef.current
      if (!a) throw new Error("No action selected")
      if (a.type === "unnote") return buildUnnotePreimage(api, a.hash)
      return a.kind === "decision"
        ? buildRefundDecisionDeposit(api, a.index)
        : buildRefundSubmissionDeposit(api, a.index)
    },
    onStatus(status) {
      const a = activeRef.current
      if (!a) return
      if (a.type === "unnote") {
        const id = `unnote-${a.hash}`
        if (status.kind === "finalized") {
          toast.success("Preimage deposit reclaimed", {
            id,
            description: `Returned on ${chain.shortName}.`,
          })
          return
        }
        if (sign.isWalletConnect) return
        if (status.kind === "broadcast") {
          toast.loading("Broadcasting…", { id, description: undefined })
        } else if (status.kind === "error") {
          toast.error("Could not reclaim deposit", { id, description: status.message })
        }
        return
      }
      const id = `refund-${a.kind}-${a.index}`
      const noun = a.kind === "decision" ? "Decision deposit" : "Submission deposit"
      if (status.kind === "finalized") {
        toast.success(`${noun} refund finalised on chain`, {
          id,
          description: `Returned to the original placer on ${chain.shortName}.`,
        })
        return
      }
      if (sign.isWalletConnect) return
      if (status.kind === "signing") {
        toast.dismiss(id)
        toast.loading("Waiting for wallet signature…", { id, description: "" })
      } else if (status.kind === "broadcast") {
        toast.dismiss(id)
        toast.loading("Broadcasting…", { id, description: "" })
      } else if (status.kind === "error") {
        toast.dismiss(id)
        toast.error("Refund failed", { id, description: status.message })
      }
    },
  })

  // Connect first if needed, otherwise start the reclaim.
  const attempt = (a: ActiveAction) => {
    if (!isConnected) {
      setWalletOpen(true)
      return
    }
    activeRef.current = a
    setActive(a)
    sign.open()
    void tx.submit()
  }

  const confirmRecordUnnote = () => {
    const p = pendingRecord
    setPendingRecord(null)
    if (p) attempt({ type: "unnote", key: p.key, hash: p.hash })
  }

  const closeModal = () => {
    sign.close()
    activeRef.current = null
    setActive(null)
    void queryClient.invalidateQueries({
      queryKey: ["reserved-deposits", chain.id, address],
    })
  }

  // Modal copy depends on which reclaim is in flight.
  const refundKind = active?.type === "refund" ? active.kind : null
  const subtitle =
    refundKind === "decision"
      ? "Approve the decision-deposit refund in your wallet"
      : refundKind === "submission"
        ? "Approve the submission-deposit refund in your wallet"
        : "Approve un-noting the preimage in your wallet"
  const successTitle =
    refundKind === "decision"
      ? "Decision deposit refunded"
      : refundKind === "submission"
        ? "Submission deposit refunded"
        : "Preimage deposit reclaimed"
  const successBody =
    refundKind != null
      ? `Returned to the original placer on ${chain.shortName}.`
      : `Returned on ${chain.shortName}.`

  const hasAny =
    (data?.referendumDeposits.length ?? 0) > 0 ||
    (data?.preimageDeposits.length ?? 0) > 0

  return (
    <section className="rounded-2xl bg-card border border-border p-6 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Coins className="w-4 h-4 text-muted-foreground" />
          Reserved deposits
        </h2>
        {data && data.total > 0n && (
          <span className="text-xs font-mono text-muted-foreground">
            {formatTokenAmount(data.total, chain)} reserved
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Deposits held when you submit a referendum or note a preimage. This is{" "}
        <span className="text-foreground">reserved</span>, not a conviction lock -
        unlocking a vote won&apos;t free it. Reclaim each below once it&apos;s
        releasable. A submission deposit comes back only if the referendum was
        approved or cancelled; a rejected or timed-out one stays reserved.
      </p>

      {query.isPending ? (
        <ul className="space-y-2 pt-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <li
              key={i}
              className="h-12 rounded-lg bg-surface-1 border border-border animate-pulse"
            />
          ))}
        </ul>
      ) : !hasAny ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-border bg-surface-1 px-4 py-3">
          No reserved governance deposits on {chain.shortName}.
        </p>
      ) : (
        <ul className="space-y-2 pt-1">
          {data!.referendumDeposits.map((d) => {
            const key = `ref-${d.index}-${d.kind}`
            const hold = depositHold(d.kind, d.status)
            return (
              <li
                key={key}
                className="flex items-center gap-3 p-3 rounded-lg bg-surface-1 border border-border"
              >
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/proposals/${d.index}?network=${chain.id}`}
                    className="text-sm text-foreground hover:text-primary"
                  >
                    Referendum #{d.index}
                  </Link>
                  <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                    {d.kind} deposit · {formatTokenAmount(d.amount, chain)}
                  </p>
                  {hold && d.status !== "Ongoing" && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{hold.reason}</p>
                  )}
                </div>
                {d.refundable ? (
                  <ReclaimButton
                    label="Refund"
                    submitting={active?.key === key && tx.isSubmitting}
                    onClick={() =>
                      attempt({ type: "refund", key, index: d.index, kind: d.kind })
                    }
                  />
                ) : (
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {hold?.label ?? "Held"}
                  </span>
                )}
              </li>
            )
          })}

          {data!.preimageDeposits.map((d) => {
            const key = `pre-${d.hash}`
            const record = d.proposalRecord
            return (
              <li
                key={key}
                className="flex items-center gap-3 p-3 rounded-lg bg-surface-1 border border-border"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-mono truncate">
                    Preimage {d.hash.slice(0, 10)}…
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {d.len != null ? `${d.len} bytes · ` : ""}
                    {formatTokenAmount(d.amount, chain)}
                  </p>
                  {record && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {record.referendumIndex != null ? (
                        <>
                          Record of{" "}
                          <Link
                            href={`/proposals/${record.referendumIndex}?network=${chain.id}`}
                            className="text-foreground hover:text-primary"
                          >
                            Referendum #{record.referendumIndex}
                          </Link>
                        </>
                      ) : (
                        "EGOV1 proposal record"
                      )}{" "}
                      - keeps your proposal&apos;s record readable
                    </p>
                  )}
                </div>
                {d.unnotable && record ? (
                  <ReclaimButton
                    label={isConnected ? "Reclaim…" : "Connect"}
                    title="Unnoting this breaks the proposal's on-chain record. You'll be asked to confirm."
                    submitting={active?.key === key && tx.isSubmitting}
                    onClick={() => {
                      if (!isConnected) {
                        setWalletOpen(true)
                        return
                      }
                      setPendingRecord({ key, hash: d.hash, amount: d.amount, record })
                    }}
                  />
                ) : d.unnotable ? (
                  <ReclaimButton
                    label={isConnected ? "Reclaim" : "Connect"}
                    submitting={active?.key === key && tx.isSubmitting}
                    onClick={() => attempt({ type: "unnote", key, hash: d.hash })}
                  />
                ) : (
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    In use by a referendum
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <Dialog
        open={pendingRecord != null}
        onOpenChange={(open) => {
          if (!open) setPendingRecord(null)
        }}
      >
        <DialogContent className="w-[calc(100%-3rem)] max-w-[calc(100%-3rem)] sm:max-w-md p-5 sm:p-6 gap-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle>Unnote your proposal&apos;s record?</DialogTitle>
            <DialogDescription className="text-left">
              {pendingRecord?.record.referendumIndex != null
                ? `Referendum #${pendingRecord.record.referendumIndex}'s on-chain metadata points at this preimage`
                : "This preimage holds an EGOV1 proposal envelope"}
              {" - "}the link from chain to the proposal&apos;s title, text and
              attachments. The chain lets you unnote it and returns{" "}
              {pendingRecord ? formatTokenAmount(pendingRecord.amount, chain) : ""}, but
              afterwards the record can&apos;t be resolved from chain: explorers,
              other clients and indexers lose it, and only this app&apos;s own
              database still has it. Only noting the exact same bytes again
              restores it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setPendingRecord(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={confirmRecordUnnote}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium hover:bg-destructive/90 transition-colors"
            >
              Unnote anyway
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle={subtitle}
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle={successTitle}
        successBody={successBody}
        successAt="in-block"
        autoDismiss={false}
        onClose={closeModal}
        onRetry={() => {
          tx.reset()
          void tx.submit()
        }}
      />
    </section>
  )
}

function ReclaimButton({
  label,
  title = "Reclaim this reserved deposit.",
  submitting,
  onClick,
}: {
  label: string
  title?: string
  submitting: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={submitting}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-purple-border transition-all disabled:opacity-50 whitespace-nowrap"
      title={title}
    >
      {submitting ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Undo2 className="w-3 h-3" />
      )}
      {label}
    </button>
  )
}

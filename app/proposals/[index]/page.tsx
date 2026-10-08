"use client"

import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Suspense, use, useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  Coins,
  FileCode,
  Hash,
  Pencil,
  Undo2,
  XOctagon,
} from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { LoadError } from "@/components/layout/load-error"
import { friendlyError } from "@/lib/utils/format-error"
import { BlockTime } from "@/components/governance/block-time"
import { PreimageDisplay } from "@/components/governance/preimage-display"
import { VotingPanel } from "@/components/governance/vote-panel"
import { TallyBar } from "@/components/governance/tally-bar"
import { TallyVotesSwiper } from "@/components/governance/tally-votes-swiper"
import { DecisionSlide } from "@/components/governance/decision-slide"
import { TrackBadge } from "@/components/governance/track-badge"
import { VotesList } from "@/components/governance/votes-list"
import { ParticipationGraph } from "@/components/governance/participation-graph"
import { AddressLink } from "@/components/governance/address-link"
import { UserChip } from "@/components/profile/user-chip"
import { PlaceDepositButton } from "@/components/governance/place-deposit-button"
import { ProposalMetadataHeader } from "@/components/governance/proposal-metadata-header"
import { ProposalWithdrawDialog } from "@/components/governance/proposal-withdraw-dialog"
import { DepositRefundAction } from "@/components/governance/refund-deposit-button"
import { LifecycleProgress } from "@/components/governance/lifecycle-progress"
import { CommentsSection } from "@/components/governance/comments-section"
import {
  Bar,
  PreimageInlineSkeleton,
  ProposalDetailBodySkeleton,
  VotePanelSkeleton,
} from "@/components/governance/skeletons"
import { useProposalMetadata } from "@/lib/query/hooks/use-proposal-metadata"
import { cn } from "@/lib/utils"
import { useReferendum } from "@/lib/query/hooks/use-referendum"
import { useReferendumHistory } from "@/lib/query/hooks/use-referendum-history"
import { useReferendumVotes } from "@/lib/query/hooks/use-referendum-votes"
import { useMe } from "@/lib/query/hooks/use-session"
import { useSubscanReferendum } from "@/lib/query/hooks/use-subscan-referendum"
import { useSubscanPreimage } from "@/lib/query/hooks/use-subscan-preimage"
import { useInlineCall, usePreimage } from "@/lib/query/hooks/use-preimage"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useTreasuryTiers } from "@/lib/query/hooks/use-treasury-tiers"
import { encodeForChain } from "@/lib/chain/ss58"
import { StatusChip } from "@/components/governance/status-chip"
import {
  type ChainConfig,
  type ChainId,
  CHAINS,
  subscanReferendumUrl,
} from "@/lib/chain/chains"
import { SubscanLink } from "@/components/governance/subscan-link"
import { RuntimeCodeHash } from "@/components/governance/runtime-code-hash"
import {
  useActiveChain,
  useChainHydrated,
  useSetActiveChain,
} from "@/lib/chain/use-chain"
import { env } from "@/lib/env"
import { formatTokenAmount } from "@/lib/chain/format"
import {
  intentFromPreimage,
  intentFromSubscanCall,
  type ProposalIntent,
} from "@/lib/governance/call-extract"
import { formatTrackName } from "@/lib/governance/display"
import { canonicalTrackName } from "@/lib/governance/tracks"
import type { Deposit, PreimageRef, Tally, TreasuryTier } from "@/lib/governance/types"
import { normaliseSubscanCall, type SubscanCallParam } from "@/lib/subscan/client"
import {
  proposalHeaderText,
  type ProposalPreview,
} from "@/lib/seo/proposal-preview"
import {
  type ProposalPreviewSource,
  useProposalPreviewSource,
} from "@/lib/seo/proposal-preview-context"

// No Suspense boundary around the page: the route renders per request (the
// layout reads the request headers), so useSearchParams needs none, and
// without one the page's HTML - its header text included - is sent in
// place rather than streamed in after the shell, which crawlers that don't
// run scripts would miss.
export default function ProposalDetailPage() {
  // What the server already knows of the proposal (see the layout).
  const preview = useProposalPreviewSource()
  const params = useParams<{ index: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const indexParam = Array.isArray(params?.index) ? params.index[0] : params?.index
  const index = Number(indexParam)

  // Shareable links: ?network=<id> forces the active chain to match the
  // proposal's home network. Without this, opening a Canary link from
  // someone whose default is Enjin Relay shows "not found" - the index
  // doesn't exist on the wrong chain.
  const setActiveChain = useSetActiveChain()
  const requestedNetwork = searchParams.get("network") as ChainId | null
  const requestedChain =
    requestedNetwork && Object.hasOwn(CHAINS, requestedNetwork)
      ? CHAINS[requestedNetwork]
      : null
  useEffect(() => {
    if (requestedChain) setActiveChain(requestedChain.id)
  }, [requestedChain, setActiveChain])

  const chain = useActiveChain()
  // The network this page shows: the link's, else the saved choice. Until
  // that has been read (server render, first paint) it is the deployment
  // default, as the server assumed - so both render the same header.
  const chainHydrated = useChainHydrated()
  const pageChainId: ChainId =
    requestedChain?.id ??
    (chainHydrated ? chain.id : env.NEXT_PUBLIC_DEFAULT_NETWORK)
  const referendumQuery = useReferendum(Number.isFinite(index) ? index : -1)
  const tracksQuery = useTracks()
  const treasuryTiers = useTreasuryTiers()
  // Read for the linked network straight away, not first for the saved one.
  const metadataQuery = useProposalMetadata(
    Number.isFinite(index) ? index : null,
    requestedChain ?? undefined,
  )
  const meQuery = useMe()
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  // Same cache entry the VotesList consumes - calling the hook again
  // is free.
  const votesQuery = useReferendumVotes(Number.isFinite(index) ? index : null)

  // When the user flips the network mid-page, the current referendum
  // index almost certainly doesn't map across chains - bounce them back
  // to the list rather than leaving a "not found" stuck on screen.
  // Exception: when the chain change was triggered by ?network=… in the
  // URL itself (a shared link), staying put is exactly what's wanted.
  const previousChainId = useRef(chain.id)
  useEffect(() => {
    if (previousChainId.current !== chain.id) {
      if (requestedNetwork !== chain.id) router.replace("/proposals")
    }
    previousChainId.current = chain.id
  }, [chain.id, requestedNetwork, router])

  // For terminal-state referenda the on-chain variant drops tally + preimage
  // + submitted block. Read state at the block right before finalisation to
  // recover them; falls back to null if pruned.
  const current = referendumQuery.data
  const finalisedAt =
    current && current.status.type !== "Ongoing" && current.status.type !== "Killed"
      ? current.status.at
      : current?.status.type === "Killed"
        ? current.status.at
        : null
  const historyQuery = useReferendumHistory(
    Number.isFinite(index) ? index : -1,
    finalisedAt,
  )

  // Subscan fallback for older terminal referenda where chain state is pruned.
  // We always fire it (cached) so we get the proposed call decoded with the
  // amount + beneficiary even when on-chain preimage has been unnoted.
  const subscanQuery = useSubscanReferendum(
    Number.isFinite(index) ? index : null,
  )

  // Resolve a preimage ref as soon as any source returns one - even before
  // the early-return branches below - so usePreimage() runs in a stable
  // position (React rules of hooks).
  const earlyProposalRef: PreimageRef | null = (() => {
    const r = current
    if (r?.status.type === "Ongoing" && "hash" in r.status.proposal) {
      return r.status.proposal
    }
    const histOngoing =
      historyQuery.data?.status.type === "Ongoing" ? historyQuery.data.status : null
    if (histOngoing && "hash" in histOngoing.proposal) return histOngoing.proposal
    const hash = subscanQuery.data?.pre_image?.hash
    if (hash) {
      return { hash: hash as `0x${string}`, len: subscanQuery.data?.pre_image?.len ?? 0 }
    }
    return null
  })()
  const preimageQuery = usePreimage(earlyProposalRef ?? undefined)
  // Small calls (≤128 bytes) ride inline in the referendum instead of as a
  // preimage - e.g. system.authorizeUpgrade, referenda.cancel. Decode those
  // straight from the referendum info: a live one with today's runtime, a
  // decided one with the runtime of the block its history was read at
  // (finalisedAt - 1, see getReferendumHistory).
  const inlineCall: { bytes: Uint8Array; at: number | null } | null = (() => {
    if (current?.status.type === "Ongoing") {
      const proposal = current.status.proposal
      return "type" in proposal && proposal.type === "Inline"
        ? { bytes: proposal.bytes, at: null }
        : null
    }
    const proposal =
      historyQuery.data?.status.type === "Ongoing" ? historyQuery.data.status.proposal : null
    return proposal && "type" in proposal && proposal.type === "Inline" && finalisedAt != null
      ? { bytes: proposal.bytes, at: finalisedAt - 1 }
      : null
  })()
  const inlineCallQuery = useInlineCall(inlineCall?.bytes, inlineCall?.at)
  // Subscan keeps the decoded preimage long after the chain prunes the
  // bytes from `preimage.preimageFor`. Run this in parallel with the
  // chain query so we have a fallback for old referenda.
  const subscanPreimageQuery = useSubscanPreimage(earlyProposalRef?.hash ?? null)

  if (!Number.isSafeInteger(index) || index < 0) {
    return (
      <Shell>
        <NotFound message="That doesn't look like a valid referendum index." />
      </Shell>
    )
  }

  // Same place in the tree while loading and once loaded, so the header
  // (and its text) stays put when the chain answers.
  const header = (live?: HeaderLive) => (
    <ProposalHeader
      index={index}
      chainId={pageChainId}
      preview={preview}
      metadata={metadataQuery}
      live={live}
    />
  )

  if (referendumQuery.isPending) {
    return (
      <Shell>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            {header()}
            <ProposalDetailBodySkeleton />
          </div>
          <div className="space-y-4">
            <VotePanelSkeleton />
          </div>
        </div>
      </Shell>
    )
  }

  if (referendumQuery.isError) {
    const err = friendlyError(referendumQuery.error)
    return (
      <Shell>
        <LoadError
          headline={err.headline}
          detail={err.detail}
          technical={err.technical}
          retry={() => referendumQuery.refetch()}
        />
      </Shell>
    )
  }

  const ref = referendumQuery.data
  if (!ref) {
    return (
      <Shell>
        <NotFound message={`Referendum #${index} does not exist on ${chain.name}.`} />
      </Shell>
    )
  }

  const isOngoing = ref.status.type === "Ongoing"
  const history = historyQuery.data
  const historyOngoing = history?.status.type === "Ongoing" ? history.status : null
  const subscan = subscanQuery.data

  // Three-tier data sourcing:
  //   live → on-chain historical state → Subscan enrichment.
  const submittedBlock =
    ref.status.type === "Ongoing"
      ? ref.status.submitted
      : (historyOngoing?.submitted ?? subscan?.submitted_block ?? null)
  const finalisedBlock = ref.status.type !== "Ongoing" ? ref.status.at : null

  const proposalRef: PreimageRef | null =
    ref.status.type === "Ongoing" && "hash" in ref.status.proposal
      ? ref.status.proposal
      : historyOngoing && "hash" in historyOngoing.proposal
        ? historyOngoing.proposal
        : subscan?.pre_image?.hash
          ? {
              hash: subscan.pre_image.hash as `0x${string}`,
              len: subscan.pre_image.len ?? 0,
            }
          : null

  const tally: Tally | null =
    ref.tally ??
    historyOngoing?.tally ??
    (subscan?.ayes_amount != null && subscan?.nays_amount != null
      ? {
          ayes: BigInt(subscan.ayes_amount),
          nays: BigInt(subscan.nays_amount),
          support: BigInt(subscan.support_amount ?? "0"),
        }
      : null)

  const submissionDeposit: Deposit | null =
    ref.status.type === "Ongoing"
      ? ref.status.submissionDeposit
      : ref.status.type === "Killed"
        ? (historyOngoing?.submissionDeposit ?? null)
        : ref.status.submissionDeposit
  const decisionDeposit: Deposit | null =
    ref.status.type === "Ongoing"
      ? ref.status.decisionDeposit
      : ref.status.type === "Killed"
        ? null
        : ref.status.decisionDeposit

  const subscanProposer =
    typeof subscan?.proposer === "string"
      ? subscan.proposer
      : (subscan?.proposer?.address ?? null)
  const proposerAddress =
    submissionDeposit?.who ?? historyOngoing?.submissionDeposit.who ?? subscanProposer

  const track =
    ref.trackId != null || historyOngoing != null || subscan?.track != null
      ? tracksQuery.data?.find(
          (t) =>
            t.id === (ref.trackId ?? historyOngoing?.trackId ?? subscan?.track),
        )
      : null

  const subscanUrl = subscanReferendumUrl(chain, ref.index)

  // Three preimage sources, picked in order:
  //   1. on-chain `preimage.preimageFor` (gone for old referenda)
  //   2. Subscan referendum endpoint's pre_image.{call_module, call_name,
  //      params} - params arrives as a JSON-encoded string in current
  //      responses; we coerce it to an array via normaliseSubscanCall.
  //   3. Subscan dedicated preimage endpoint by hash (works without a
  //      key for almost all noted preimages - this is the one Subscan's
  //      own /preimage/<hash> page is built on)
  const subscanPreimage = subscanPreimageQuery.data
  const decodedCall =
    normaliseSubscanCall(subscan?.pre_image) ?? normaliseSubscanCall(subscanPreimage)

  const onChainIntent: ProposalIntent =
    preimageQuery.data?.section
      ? intentFromPreimage(preimageQuery.data, chain)
      : inlineCallQuery.data?.section
        ? intentFromPreimage(inlineCallQuery.data, chain)
        : null
  const subscanIntent: ProposalIntent = intentFromSubscanCall(decodedCall, chain)
  const intent: ProposalIntent = onChainIntent ?? subscanIntent

  // The spend tier this referendum's track authorizes on the connected
  // runtime, so an amount above its limit (e.g. filed before the tiers were
  // corrected) is flagged before it fails at enactment. `treasury.spend`
  // converts its asset amount before the check, so only spend_local is compared.
  const spendLimitTier =
    isOngoing && track && intent?.kind === "treasury-spend" && intent.method !== "spend"
      ? (treasuryTiers.table?.tiers.find(
          (t) => canonicalTrackName(t.origin) === canonicalTrackName(track.name),
        ) ?? null)
      : null

  return (
    <Shell>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {header({
            badges: (
              <>
                <StatusChip type={ref.status.type} />
                <TrackBadge
                  track={track ?? null}
                  trackId={ref.trackId ?? historyOngoing?.trackId ?? null}
                />
              </>
            ),
            dates: (
              <>
                {submittedBlock != null && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Submitted <BlockTime block={submittedBlock} showBlock />
                  </span>
                )}
                {!isOngoing && finalisedBlock != null && submittedBlock !== finalisedBlock && (
                  <span className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    Finalised <BlockTime block={finalisedBlock} showBlock />
                  </span>
                )}
              </>
            ),
            proposerAddress,
            actions:
              metadataQuery.data &&
              isOngoing &&
              isProposerWallet(
                meQuery.data?.address ?? null,
                metadataQuery.data.proposer_address,
                chain.id,
              ) ? (
                <ProposerActions
                  referendumIndex={ref.index}
                  networkId={chain.id}
                  isOngoing={isOngoing}
                  signedIn={meQuery.data != null}
                  isWithdrawn={Boolean(metadataQuery.data.withdrawn_at)}
                  onWithdraw={() => setWithdrawOpen(true)}
                />
              ) : null,
          })}

          {/* What is asked comes first, then how long there is to decide. */}
          {intent?.kind === "treasury-spend" && (
            <TreasuryRequestSummary intent={intent} chain={chain} limitTier={spendLimitTier} />
          )}

          <LifecycleProgress referendum={ref} track={track ?? null} intent={intent} />

          <TallyVotesSwiper
            slides={[
              {
                id: "tally",
                label: "Tally",
                header: (
                  <>
                    <h2 className="font-semibold text-foreground">Tally</h2>
                    {!isOngoing && tally && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Final
                      </span>
                    )}
                  </>
                ),
                content: (
                  <>
                    <TallyBar
                      tally={tally}
                      chain={chain}
                      voterCount={votesQuery.data?.length ?? null}
                    />
                    {!isOngoing && !tally && historyQuery.isSuccess && (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Historical tally pruned from chain state.{" "}
                        <a
                          href={subscanUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80"
                        >
                          View on Subscan
                        </a>{" "}
                        for the final figures.
                      </p>
                    )}
                  </>
                ),
              },
              ...(isOngoing
                ? [
                    {
                      id: "decision",
                      label: "Decision",
                      header: (
                        <>
                          <h2 className="font-semibold text-foreground">
                            Decision
                          </h2>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Thresholds
                          </span>
                        </>
                      ),
                      content: (
                        <DecisionSlide
                          referendum={ref}
                          track={track ?? null}
                          tally={tally}
                          chain={chain}
                        />
                      ),
                    },
                  ]
                : []),
              {
                id: "votes",
                label: "Votes",
                header: (
                  <>
                    <h2 className="font-semibold text-foreground">Votes</h2>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {isOngoing ? "Live" : "Final"}
                    </span>
                  </>
                ),
                content: (
                  <>
                    <ParticipationGraph
                      referendumIndex={ref.index}
                      chain={chain}
                    />
                    <div className="border-t border-border pt-5">
                      <VotesList referendumIndex={ref.index} chain={chain} />
                    </div>
                  </>
                ),
              },
            ]}
          />

          {metadataQuery.data && (
            <ProposalMetadataHeader metadata={metadataQuery.data} chain={chain} />
          )}

          <CommentsSection proposalUuid={metadataQuery.data?.id ?? null} />

          <div className="rounded-2xl bg-card border border-border p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-foreground">Details</h2>
              <div className="grid grid-cols-2 gap-4 text-sm mt-3">
                <DepositRow
                  label="Submission"
                  deposit={submissionDeposit}
                  chain={chain}
                  fallbackLabel={
                    ref.status.type === "Killed"
                      ? "Slashed"
                      : !isOngoing
                        ? "Refunded"
                        : "Not yet placed"
                  }
                  action={
                    submissionDeposit ? (
                      <DepositRefundAction
                        referendumIndex={ref.index}
                        kind="submission"
                        status={ref.status.type}
                        chain={chain}
                      />
                    ) : null
                  }
                />
                <DepositRow
                  label="Decision"
                  deposit={decisionDeposit}
                  chain={chain}
                  fallback={
                    ref.status.type === "Approved" ||
                    ref.status.type === "Rejected" ||
                    ref.status.type === "TimedOut" ||
                    ref.status.type === "Cancelled" ? (
                      <span className="text-sm text-muted-foreground">Refunded</span>
                    ) : isOngoing ? (
                      <PlaceDepositButton
                        referendumIndex={ref.index}
                        trackId={ref.trackId}
                        chain={chain}
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">Not placed</span>
                    )
                  }
                  action={
                    decisionDeposit ? (
                      <DepositRefundAction
                        referendumIndex={ref.index}
                        kind="decision"
                        status={ref.status.type}
                        chain={chain}
                      />
                    ) : null
                  }
                />
              </div>
            </div>

            {(inlineCall || decodedCall || proposalRef) && (
              <div className="pt-5 border-t border-border">
                {/* An inline call that won't decode yields to Subscan's
                    decode when there is one; otherwise it shows raw. */}
                {inlineCall && !(inlineCallQuery.isError && decodedCall) ? (
                  <PreimageDisplay inlineBytes={inlineCall.bytes} inlineAt={inlineCall.at} />
                ) : decodedCall ? (
                  <SubscanCallDisplay
                    call={decodedCall}
                    hash={
                      proposalRef?.hash ??
                      (subscan?.pre_image?.hash as `0x${string}` | undefined) ??
                      (subscanPreimage?.hash as `0x${string}` | undefined)
                    }
                    len={
                      proposalRef?.len ??
                      subscan?.pre_image?.len ??
                      subscanPreimage?.length ??
                      0
                    }
                    chain={chain}
                  />
                ) : proposalRef ? (
                  subscanPreimageQuery.isPending ? (
                    <PreimageInlineSkeleton />
                  ) : (
                    <PreimageDisplay preimageRef={proposalRef} />
                  )
                ) : null}
                <RuntimeCodeHash
                  code={preimageQuery.data?.runtimeCode ?? inlineCallQuery.data?.runtimeCode}
                />
              </div>
            )}
          </div>

          {!inlineCall && !decodedCall && !proposalRef && !isOngoing && (
            <div className="rounded-2xl bg-card border border-border p-6 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Preimage</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Call data unavailable on chain, and our anonymous Subscan
                request was rejected - Subscan now requires an API key on
                every read. Set{" "}
                <code className="font-mono">SUBSCAN_API_KEY</code> on the
                server to render decoded calls inline.
              </p>
              <SubscanLink href={subscanUrl} label="View on Subscan" />
            </div>
          )}
        </div>

        <div className="space-y-4">
          {isOngoing && decisionDeposit == null ? (
            <div className="rounded-2xl bg-amber-500/5 border border-amber-500/30 p-5 space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Decision deposit not yet placed
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  This referendum can&apos;t enter the deciding phase until
                  the per-track decision deposit is reserved. Voting opens as
                  soon as it is. Anyone can place it.
                </p>
              </div>
              <PlaceDepositButton
                referendumIndex={ref.index}
                trackId={ref.trackId}
                chain={chain}
              />
            </div>
          ) : (
            <VotingPanel
              referendumIndex={ref.index}
              isOngoing={isOngoing}
              trackId={ref.trackId}
            />
          )}
        </div>
      </div>

      {metadataQuery.data && (
        <ProposalWithdrawDialog
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          metadata={metadataQuery.data}
        />
      )}
    </Shell>
  )
}

/** The header's chain parts, once the referendum has been read. */
type HeaderLive = {
  badges: React.ReactNode
  dates: React.ReactNode
  proposerAddress: string | null
  actions: React.ReactNode
}

type HeaderProps = {
  index: number
  chainId: ChainId
  metadata: ReturnType<typeof useProposalMetadata>
  /** Undefined while the referendum is read from the chain. */
  live?: HeaderLive
}

/**
 * The card at the top of the page. Its text - title, summary, proposer,
 * withdrawal - comes from the server's preview until the browser's own
 * read of the proposal answers, so it shows before the chain does; the
 * chain parts (status, track, dates) have placeholders until then.
 * Browsers get the preview as a promise: the card waits for it in its own
 * Suspense boundary, showing what the browser knows meanwhile.
 */
function ProposalHeader({
  preview,
  ...props
}: HeaderProps & { preview: ProposalPreviewSource }) {
  if (!isPromise(preview)) return <ProposalHeaderCard {...props} preview={preview} />
  return (
    <Suspense fallback={<ProposalHeaderCard {...props} preview={null} />}>
      <StreamedProposalHeaderCard {...props} preview={preview} />
    </Suspense>
  )
}

function StreamedProposalHeaderCard({
  preview,
  ...props
}: HeaderProps & { preview: Promise<ProposalPreview | null> }) {
  return <ProposalHeaderCard {...props} preview={use(preview)} />
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | null)?.then === "function"
}

function ProposalHeaderCard({
  index,
  chainId,
  metadata,
  live,
  preview,
}: HeaderProps & { preview: ProposalPreview | null }) {
  // The server read the network it was linked to (or the default); a page
  // showing another one can't use it.
  const shown =
    preview && preview.chainId === chainId && preview.index === index ? preview : null
  const text = proposalHeaderText(metadata.data, shown, metadata.isPending)
  const proposer = text === "pending" ? null : text.proposer
  const proposerAddress = live ? live.proposerAddress : (proposer?.address ?? null)
  const editedAt = metadata.data?.edited_at

  return (
    <div className="rounded-2xl bg-card border border-border p-6">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {live ? (
          live.badges
        ) : (
          <>
            <Bar className="h-6 w-20 rounded-full animate-pulse" />
            <Bar className="h-4 w-24 animate-pulse" />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Hash className="w-3.5 h-3.5" />
            {index}
          </span>
          <SubscanLink href={subscanReferendumUrl(CHAINS[chainId], index)} />
        </div>
      </div>

      {text !== "pending" && text.withdrawn && (
        <div className="mb-4 rounded-xl bg-destructive/5 border border-destructive/30 p-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-xs leading-relaxed">
            <p className="font-medium text-foreground">
              Proposer has withdrawn this proposal - please vote NAY.
            </p>
            {text.withdrawn.reason && (
              <p className="text-muted-foreground mt-0.5 break-words">
                {text.withdrawn.reason}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              Off-chain flag - voting is still open. The chain doesn&apos;t
              let the proposer cancel directly.
            </p>
          </div>
        </div>
      )}

      <h1 className="text-xl sm:text-2xl font-semibold text-foreground leading-tight mb-2 break-words">
        {text === "pending" ? (
          // Hold a skeleton until the EGOV lookup settles, so a proposal
          // that HAS a title doesn't flash "Referendum #N" first and then
          // swap. Once it resolves (title found, or no metadata / error),
          // we show the title or fall back to the index.
          <span className="inline-block h-7 w-72 max-w-full rounded-md bg-surface-3 animate-pulse align-middle">
            <span className="sr-only">Referendum #{index}</span>
          </span>
        ) : (
          <>
            {text.title ?? `Referendum #${index}`}
            {text.edited && (
              <span
                className="ml-2 align-middle text-[11px] font-normal text-muted-foreground"
                title={
                  editedAt
                    ? `Edited ${new Date(editedAt).toLocaleString()}${metadata.data && metadata.data.edit_count > 1 ? ` · ${metadata.data.edit_count} edits` : ""}`
                    : undefined
                }
              >
                (edited)
              </span>
            )}
          </>
        )}
      </h1>

      {text !== "pending" && text.summary && (
        <p className="text-sm text-muted-foreground leading-relaxed [overflow-wrap:anywhere]">
          {text.summary}
        </p>
      )}

      <div className="flex items-center gap-x-4 gap-y-2 mt-5 pt-5 border-t border-border text-xs text-muted-foreground flex-wrap">
        {live ? live.dates : <Bar className="h-3 w-40 animate-pulse" />}
        {proposerAddress && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">Proposer</span>
            <UserChip
              address={proposerAddress}
              chainId={chainId}
              fallbackName={
                proposer && isProposerWallet(proposerAddress, proposer.address, chainId)
                  ? proposer.name
                  : null
              }
              size="sm"
            />
          </span>
        )}
      </div>

      {live?.actions}
    </div>
  )
}

/**
 * Dedicated row for proposer-only actions on the proposal card. Lives
 * below the metadata footer so it never has to compete with the
 * status/track/hash chips at the top - those chips wrap badly on
 * mobile when extra buttons crowd in.
 *
 * Edit is always available (the off-chain narrative can be revised on
 * a terminal referendum). Withdraw is only meaningful while the
 * referendum is Ongoing; once it's resolved, withdrawing it sends no
 * useful signal.
 */
function ProposerActions({
  referendumIndex,
  networkId,
  isOngoing,
  signedIn,
  isWithdrawn,
  onWithdraw,
}: {
  referendumIndex: number
  networkId: ChainId
  isOngoing: boolean
  signedIn: boolean
  isWithdrawn: boolean
  onWithdraw: () => void
}) {
  return (
    <div className="mt-5 pt-5 border-t border-border">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Proposer actions
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/proposals/${referendumIndex}/edit?network=${networkId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:border-purple-border hover:bg-surface-2 transition-colors"
            title={
              signedIn
                ? "Edit the off-chain narrative"
                : "Sign in with the proposer wallet to edit"
            }
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit Proposal
          </Link>
          {isOngoing && (
            <button
              type="button"
              onClick={onWithdraw}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                isWithdrawn
                  ? "border-border text-foreground hover:border-purple-border hover:bg-surface-2"
                  : "border-destructive/40 text-destructive hover:border-destructive/70 hover:bg-destructive/10",
              )}
              title={
                signedIn
                  ? isWithdrawn
                    ? "Clear the withdrawal banner"
                    : "Mark this proposal as withdrawn (off-chain only)"
                  : "Sign in with the proposer wallet to withdraw"
              }
            >
              {isWithdrawn ? (
                <>
                  <Undo2 className="w-3.5 h-3.5" />
                  Undo withdraw
                </>
              ) : (
                <>
                  <XOctagon className="w-3.5 h-3.5" />
                  Withdraw
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * True when the connected wallet's address resolves to the same
 * public key as the proposer on chain. We re-encode both into the
 * active chain's SS58 prefix before comparing, since wallets can hand
 * back addresses in their default prefix (e.g. a Polkadot-prefix
 * `1…` from the extension while the DB stored an `en…` form).
 */
function isProposerWallet(
  candidateAddress: string | null,
  proposerAddress: string,
  chainId: ChainId,
): boolean {
  if (!candidateAddress) return false
  try {
    return (
      encodeForChain(candidateAddress, chainId) ===
      encodeForChain(proposerAddress, chainId)
    )
  } catch {
    return candidateAddress === proposerAddress
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-5xl mx-auto">
          <Link
            href="/proposals"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All proposals
          </Link>
          {children}
        </div>
      </main>
      <Footer />
    </div>
  )
}

function NotFound({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="rounded-2xl bg-card border border-border p-12 text-center space-y-3">
      <p className="text-foreground font-medium">Not found</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      {retry && (
        <button onClick={retry} className="text-sm text-primary hover:text-primary/80">
          Retry
        </button>
      )}
    </div>
  )
}

function SubscanCallDisplay({
  call,
  hash,
  len,
  chain,
}: {
  call: NonNullable<NonNullable<ReturnType<typeof useSubscanReferendum>["data"]>["pre_image"]>["proposed_call"]
  hash?: `0x${string}`
  len: number
  chain: ChainConfig
}) {
  if (!call) return null
  const section = call.call_module ?? ""
  const method = call.call_name ?? ""
  const params: SubscanCallParam[] = call.params ?? []

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <FileCode className="w-4 h-4 text-primary" />
        Preimage
      </h3>

      <div className="rounded-lg bg-surface-2 border border-border p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Call
        </p>
        <p className="font-mono text-sm text-foreground">
          <span className="text-primary">{section.toLowerCase()}</span>
          <span className="text-muted-foreground">.</span>
          <span>{method}</span>
        </p>
      </div>

      {params.length > 0 && (
        <div className="rounded-lg bg-surface-2 border border-border p-3 space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Arguments
          </p>
          {params.map((param, i) => (
            <ParamRow key={`${param.name ?? i}`} param={param} chain={chain} />
          ))}
        </div>
      )}

      {hash && (
        <div className="text-[11px] text-muted-foreground space-y-1 font-mono break-all pt-1">
          <p>
            <span className="not-italic text-muted-foreground/70 mr-1.5 font-sans">
              Hash
            </span>
            {hash}
          </p>
          {len > 0 && (
            <p>
              <span className="not-italic text-muted-foreground/70 mr-1.5 font-sans">
                Length
              </span>
              {len} bytes
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ParamRow({ param, chain }: { param: SubscanCallParam; chain: ChainConfig }) {
  const name = param.name ?? "value"
  // Subscan returns amount-shaped fields as decimal strings of planck.
  const isAmount =
    /^amount$|^value$|^balance$/i.test(name) && typeof param.value === "string"
  const isBeneficiary = /^beneficiary$|^who$|^to$|^dest$/i.test(name)

  let rendered: React.ReactNode

  if (isAmount && typeof param.value === "string" && /^\d+$/.test(param.value)) {
    rendered = (
      <span className="text-foreground font-mono">
        {formatTokenAmount(BigInt(param.value), chain)}
      </span>
    )
  } else if (isBeneficiary) {
    const addr = extractAddress(param.value)
    rendered = addr ? (
      <AddressLink value={addr} chain={chain} full />
    ) : (
      <pre className="font-mono text-foreground text-[11px] whitespace-pre-wrap break-all">
        {formatJson(param.value)}
      </pre>
    )
  } else if (typeof param.value === "string" || typeof param.value === "number") {
    rendered = <span className="text-foreground font-mono break-all">{String(param.value)}</span>
  } else {
    rendered = (
      <pre className="font-mono text-foreground text-[11px] whitespace-pre-wrap break-all">
        {formatJson(param.value)}
      </pre>
    )
  }

  return (
    <div className="text-xs">
      <p className="text-muted-foreground mb-1">{name}</p>
      {rendered}
    </div>
  )
}

function extractAddress(value: unknown): string | null {
  // Accept SS58 addresses AND raw hex pubkeys (AddressLink translates
  // 32-byte hex pubkeys to the active chain's SS58 prefix).
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value
    if (value.length >= 40 && !value.startsWith("0x")) return value
    return null
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>
    if (typeof v.Id === "string") return v.Id
    if (typeof v.id === "string") return v.id
    if (typeof v.address === "string") return v.address
  }
  return null
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function DepositRow({
  label,
  deposit,
  chain,
  fallback,
  fallbackLabel = "Not placed",
  action,
}: {
  label: string
  deposit: Deposit | null
  chain: ChainConfig
  fallback?: React.ReactNode
  fallbackLabel?: string
  action?: React.ReactNode
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label} deposit</p>
      {deposit ? (
        <>
          <p className="font-semibold text-foreground">
            {formatTokenAmount(deposit.amount, chain)}
          </p>
          <div className="text-xs mt-0.5">
            <UserChip address={deposit.who} size="xs" />
          </div>
          {action && <div className="mt-2">{action}</div>}
        </>
      ) : fallback != null ? (
        <div className="text-sm">{fallback}</div>
      ) : (
        <p className="text-sm text-muted-foreground">{fallbackLabel}</p>
      )}
    </div>
  )
}

function TreasuryRequestSummary({
  intent,
  chain,
  limitTier,
}: {
  intent: Extract<ProposalIntent, { kind: "treasury-spend" }>
  chain: ChainConfig
  /** The spend tier the referendum's track authorizes, when known. */
  limitTier: TreasuryTier | null
}) {
  const limit = limitTier?.maxAmount ?? null
  return (
    <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-card to-card border border-purple-border p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/15 border border-purple-border flex items-center justify-center flex-shrink-0">
          <Coins className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Treasury request
          </p>
          <p className="text-2xl font-semibold text-foreground tabular-nums mt-1">
            {formatTokenAmount(intent.amount, chain, { maxFractionDigits: 4 })}
          </p>
          <div className="mt-3 pt-3 border-t border-purple-border/40 text-xs space-y-2">
            <p className="text-muted-foreground">Beneficiary</p>
            <UserChip address={intent.beneficiary} size="md" />
            <p className="font-mono text-[11px] text-muted-foreground break-all">
              <AddressLink value={intent.beneficiary} chain={chain} full />
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
            If approved, this referendum dispatches{" "}
            <code className="font-mono text-foreground">treasury.{intent.method}</code>{" "}
            and pays the beneficiary from the {chain.shortName} treasury.
          </p>
          {limitTier && limit != null && intent.amount > limit && (
            <p className="text-[11px] text-amber-300 mt-2 leading-relaxed">
              The amount is above {formatTrackName(limitTier.origin)}&apos;s spend limit on this
              runtime ({formatTokenAmount(limit, chain)}). Unless an upgrade raises
              that limit before enactment, the spend fails with InsufficientPermission and nothing
              is paid.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

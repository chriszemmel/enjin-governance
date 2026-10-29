"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Calendar, CheckCircle2, ExternalLink, Users, XCircle } from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { LoadError } from "@/components/layout/load-error"
import { Bar } from "@/components/governance/skeletons"
import { LifecycleProgress } from "@/components/governance/lifecycle-progress"
import { PreimageDisplay } from "@/components/governance/preimage-display"
import { StatusChip } from "@/components/governance/status-chip"
import { TallyVotesSwiper } from "@/components/governance/tally-votes-swiper"
import { UserChip } from "@/components/profile/user-chip"
import { FellowshipVotePanel } from "@/components/fellowship/fellowship-vote-panel"
import { RankBadge } from "@/components/fellowship/rank-badge"
import { RankedTally } from "@/components/fellowship/ranked-tally"
import { useDecodedCall } from "@/components/fellowship/call-summary"
import { FastTrackCard } from "@/components/fellowship/fast-track-card"
import { subscanBlockUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { samePublicKey } from "@/lib/chain/ss58"
import {
  FELLOWSHIP_PALLET,
  fellowshipTrackCaption,
  type FellowshipReferendum,
} from "@/lib/governance/fellowship"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import {
  useFellowshipMembers,
  useFellowshipReferendum,
  useFellowshipTracks,
  useFellowshipVotes,
} from "@/lib/query/hooks/use-fellowship"
import { useReferendumHistory } from "@/lib/query/hooks/use-referendum-history"
import { friendlyError } from "@/lib/utils/format-error"
import { cn } from "@/lib/utils"

export default function FellowshipReferendumPage() {
  const params = useParams<{ index: string }>()
  const raw = Array.isArray(params?.index) ? params.index[0] : params?.index
  const index = raw != null && /^\d+$/.test(raw) ? Number(raw) : -1
  const chain = useActiveChain()
  const query = useFellowshipReferendum(index)
  const tracksQuery = useFellowshipTracks()
  const membersQuery = useFellowshipMembers()
  const votesQuery = useFellowshipVotes(index)
  const currentBlock = useCurrentBlock().data ?? null

  const live = query.data ?? null
  const decidedAt = live && live.status.type !== "Ongoing" ? live.status.at : null
  const historyQuery = useReferendumHistory(index, decidedAt, undefined, FELLOWSHIP_PALLET)
  const history = historyQuery.data ?? null
  // A decided referendum keeps only its outcome: its call, track and
  // submission come from the block before the decision.
  const ongoing =
    live?.status.type === "Ongoing"
      ? live.status
      : history?.status.type === "Ongoing"
        ? history.status
        : null
  const trackId = live?.trackId ?? history?.trackId ?? null
  const track = tracksQuery.data?.find((t) => t.id === trackId) ?? null
  const decodedCall = useDecodedCall(
    live?.status.type === "Ongoing" ? live : history,
    decidedAt ? decidedAt - 1 : null,
  )
  const callName = decodedCall ? `${decodedCall.section}.${decodedCall.method}` : null

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-5xl mx-auto">
          <Link
            href={`/fellowship?network=${chain.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Fellowship
          </Link>

          {index < 0 ? (
            <p className="text-sm text-muted-foreground">Not a fellowship referendum number.</p>
          ) : query.isError ? (
            <LoadError {...friendlyError(query.error)} retry={() => query.refetch()} />
          ) : query.isPending ? (
            <div className="space-y-4">
              <Bar className="h-36 rounded-2xl" />
              <Bar className="h-48 rounded-2xl" />
            </div>
          ) : !live ? (
            <p className="text-sm text-muted-foreground">
              F#{index} does not exist on {chain.name}.
            </p>
          ) : (
            <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
              <div className="space-y-4 min-w-0">
                <section className="rounded-2xl bg-card border border-border p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusChip type={live.status.type} />
                      {trackId != null && (
                        <span className="text-[11px] text-muted-foreground">
                          {fellowshipTrackCaption(track, trackId)}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-purple-border bg-primary/8 text-primary">
                        <Users className="w-3 h-3" />
                        Fellowship
                      </span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">F#{index}</span>
                  </div>
                  <h1 className="text-xl sm:text-2xl font-semibold text-foreground break-words">
                    {callName ?? `Fellowship referendum F#${index}`}
                  </h1>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground border-t border-border pt-4">
                    {ongoing && (
                      <a
                        href={subscanBlockUrl(chain, ongoing.submitted)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        Submitted <span className="font-mono">#{ongoing.submitted.toLocaleString("en-US")}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {ongoing && (
                      <span className="inline-flex items-center gap-1.5">
                        Proposer <UserChip address={ongoing.submissionDeposit.who} size="xs" />
                        <ProposerRank address={ongoing.submissionDeposit.who} members={membersQuery.data} />
                      </span>
                    )}
                  </div>
                </section>

                <LifecycleProgress
                  referendum={live}
                  track={track}
                  pallet={FELLOWSHIP_PALLET}
                />

                {ongoing && (
                  <section className="rounded-2xl bg-card border border-border p-5">
                    {"type" in ongoing.proposal ? (
                      <PreimageDisplay inlineBytes={ongoing.proposal.bytes} inlineAt={decidedAt ? decidedAt - 1 : null} />
                    ) : (
                      <PreimageDisplay preimageRef={ongoing.proposal} preimageAt={decidedAt ? decidedAt - 1 : null} />
                    )}
                  </section>
                )}

                <FastTrackCard
                  bytes={ongoing && "type" in ongoing.proposal ? ongoing.proposal.bytes : decodedCall?.bytes}
                  pallet={FELLOWSHIP_PALLET}
                  status={live.status.type}
                />

                <section className="rounded-2xl bg-card border border-border p-5">
                  <TallyVotesSwiper
                    slides={[
                      {
                        id: "tally",
                        label: "Tally",
                        header: <h2 className="font-semibold text-foreground">Tally</h2>,
                        content: (
                          <RankedTally
                            referendum={live as FellowshipReferendum}
                            track={track}
                            members={membersQuery.data}
                            voterCount={votesQuery.data?.length ?? null}
                            currentBlock={currentBlock}
                          />
                        ),
                      },
                      {
                        id: "votes",
                        label: "Votes",
                        header: <h2 className="font-semibold text-foreground">Votes</h2>,
                        content: <VotesList votes={votesQuery.data} members={membersQuery.data} decided={live.status.type !== "Ongoing"} />,
                      },
                    ]}
                  />
                </section>
              </div>

              <FellowshipVotePanel
                index={index}
                trackId={trackId}
                isOngoing={live.status.type === "Ongoing"}
              />
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}

function ProposerRank({
  address,
  members,
}: {
  address: string
  members: { address: string; rank: number }[] | undefined
}) {
  const m = members?.find((x) => samePublicKey(x.address, address))
  return m ? <RankBadge rank={m.rank} /> : null
}

function VotesList({
  votes,
  members,
  decided,
}: {
  votes: { voter: string; aye: boolean; weight: number }[] | undefined
  members: { address: string; rank: number }[] | undefined
  decided: boolean
}) {
  if (!votes) return <Bar className="h-24 rounded-xl" />
  if (votes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        {decided
          ? "Votes are cleared from the chain once a fellowship referendum ends."
          : "No member has voted yet."}
      </p>
    )
  }
  return (
    <ul className="space-y-1.5">
      {votes.map((v) => {
        const rank = members?.find((m) => samePublicKey(m.address, v.voter))?.rank
        return (
          <li
            key={v.voter}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg border",
              v.aye ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5",
            )}
          >
            {v.aye ? (
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <UserChip address={v.voter} size="sm" />
            </div>
            {rank != null && <RankBadge rank={rank} />}
            <span className="font-mono text-sm font-semibold tabular-nums w-8 text-right">{v.weight}</span>
          </li>
        )
      })}
    </ul>
  )
}

"use client"

import Link from "next/link"
import { ArrowRight, Eye, Send, Vote } from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { ProposalCard } from "@/components/governance/proposal-card"
import { Bar, ProposalCardSkeleton } from "@/components/governance/skeletons"
import { cn } from "@/lib/utils"
import { type ChainConfig, enabledChains } from "@/lib/chain/chains"
import { useActiveChain, useChainHydrated } from "@/lib/chain/use-chain"
import { useReferenda } from "@/lib/query/hooks/use-referenda"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useProposalMetadataBatch } from "@/lib/query/hooks/use-proposal-metadata"

const heroLine = (network: string) =>
  `On-chain governance for the ${network}. Browse referenda, cast conviction ` +
  "votes, and submit treasury requests."

// The longest network name the hero line can show (see the hero below).
const LONGEST_NETWORK_NAME = enabledChains().reduce(
  (longest, c) => (c.name.length > longest.length ? c.name : longest),
  "Enjin network",
)

export function HomePage() {
  const chain = useActiveChain()
  const chainHydrated = useChainHydrated()
  const referendaQuery = useReferenda()
  const tracksQuery = useTracks()

  const allReferenda = referendaQuery.data ?? []
  const activeReferenda = allReferenda.filter((r) => r.status.type === "Ongoing")
  const decidingCount = activeReferenda.filter(
    (r) => r.status.type === "Ongoing" && r.status.deciding != null,
  ).length
  const awaitingDepositCount = activeReferenda.filter(
    (r) =>
      r.status.type === "Ongoing" && r.status.deciding == null && r.status.decisionDeposit == null,
  ).length

  const featured = activeReferenda.slice(0, 3)
  const trackById = new Map((tracksQuery.data ?? []).map((t) => [t.id, t]))
  const metadataQuery = useProposalMetadataBatch(featured.map((r) => r.index))

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />

      <main>
        <section className="relative pt-32 pb-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[400px] h-[300px] rounded-full bg-primary/8 blur-[80px] pointer-events-none" />

          <div className="max-w-5xl mx-auto text-center relative">
            <HeroPill
              chain={chain}
              // Hold on "loading" until the persisted chain choice has
              // landed. Otherwise the pill paints "Connecting to Enjin
              // Relay…" before flipping to "Connecting to Canary Relay…"
              // a tick later - the user sees a chain we never actually
              // settled on.
              state={
                !chainHydrated || referendaQuery.isPending
                  ? "loading"
                  : referendaQuery.isError
                    ? "error"
                    : activeReferenda.length === 0
                      ? "idle"
                      : "active"
              }
              count={activeReferenda.length}
              hydrated={chainHydrated}
            />

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-foreground mb-6 leading-[1.05]">
              Shape the future of <span className="text-gradient-purple">Enjin</span>
            </h1>

            {/* The network is named once the saved choice has been read. A
                hidden copy with the longest name holds the height, so nothing
                below moves when the name comes in. */}
            <div className="grid text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
              <p aria-hidden className="invisible col-start-1 row-start-1">
                {heroLine(LONGEST_NETWORK_NAME)}
              </p>
              <p className="col-start-1 row-start-1 text-muted-foreground">
                {heroLine(chainHydrated ? chain.name : "Enjin network")}
              </p>
            </div>

            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Link
                href="/proposals"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-purple-dim transition-all duration-200 glow-purple-sm"
              >
                View Proposals
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/create"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border text-foreground font-medium hover:border-purple-border hover:bg-surface-1 transition-all duration-200"
              >
                Create Proposal
              </Link>
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 pb-16">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label="Active"
                value={referendaQuery.isSuccess ? String(activeReferenda.length) : "-"}
                loading={referendaQuery.isPending}
              />
              <StatCard
                label="Deciding"
                value={referendaQuery.isSuccess ? String(decidingCount) : "-"}
                loading={referendaQuery.isPending}
              />
              <StatCard
                label="Awaiting deposit"
                value={referendaQuery.isSuccess ? String(awaitingDepositCount) : "-"}
                loading={referendaQuery.isPending}
              />
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 pb-16">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Active Proposals</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Vote before they finish deciding
                </p>
              </div>
              <Link
                href="/proposals"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                View all
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {referendaQuery.isPending ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <ProposalCardSkeleton key={i} />
                ))}
              </div>
            ) : featured.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Nothing currently in the decision queue.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {featured.map((ref) => (
                  <ProposalCard
                    key={ref.index}
                    referendum={ref}
                    track={ref.trackId != null ? trackById.get(ref.trackId) : null}
                    metadata={metadataQuery.data?.get(ref.index) ?? null}
                    metadataPending={metadataQuery.isLoading}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="px-4 sm:px-6 lg:px-8 pb-24">
          <div className="max-w-5xl mx-auto">
            <div className="rounded-2xl border border-border bg-card p-8 lg:p-10">
              <div className="text-center mb-10">
                <h2 className="text-2xl font-semibold text-foreground mb-3">
                  Governance made simple
                </h2>
                <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
                  Enjin Governance abstracts blockchain complexity so anyone can participate
                  meaningfully in shaping the network.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  {
                    icon: <Vote className="w-5 h-5" />,
                    title: "Vote or delegate",
                    desc: "Back proposals with conviction-weighted ENJ or staked sENJ, or delegate your voting power on any track to someone you trust.",
                  },
                  {
                    icon: <Send className="w-5 h-5" />,
                    title: "Propose & fund",
                    desc: "Request treasury funding, or file governance proposals (cancel, whitelist, runtime upgrade) with track and enactment control - end to end.",
                  },
                  {
                    icon: <Eye className="w-5 h-5" />,
                    title: "On-chain & transparent",
                    desc: "Browse referenda, tracks, and tallies live from the chain. No wallet required to look, and every vote is recorded on-chain.",
                  },
                ].map((feature) => (
                  <div key={feature.title} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 border border-purple-border flex items-center justify-center text-primary shrink-0">
                        {feature.icon}
                      </div>
                      <h3 className="font-semibold text-foreground">{feature.title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

function StatCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="rounded-xl bg-card border border-border p-5">
      {loading ? (
        <Bar className="h-8 w-16" inCard={false} />
      ) : (
        <p className="text-2xl font-semibold text-foreground">{value}</p>
      )}
      <p className="text-sm text-muted-foreground mt-1">{label}</p>
    </div>
  )
}

/**
 * Hero status pill - color follows the network state:
 *   - loading: brand purple, or canary amber when connecting to a
 *              testnet so the user sees they're on canary at a glance
 *   - error:   red    (RPC unreachable)
 *   - idle:    muted  (no active referenda)
 *   - active:  green  (a clear "go vote" signal)
 */
function HeroPill({
  chain,
  state,
  count,
  hydrated,
}: {
  chain: ChainConfig
  state: "loading" | "error" | "idle" | "active"
  count: number
  /** False while zustand persist hasn't yet merged the saved chain id. */
  hydrated: boolean
}) {
  const tone = (() => {
    switch (state) {
      case "active":
        return {
          wrap: "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400",
          dot: "bg-emerald-500",
        }
      case "error":
        return {
          wrap: "border-destructive/40 bg-destructive/8 text-destructive",
          dot: "bg-destructive",
        }
      case "idle":
        return {
          wrap: "border-border bg-surface-1 text-muted-foreground",
          dot: "bg-muted-foreground",
        }
      default:
        // Neutral tone until we know the chain - avoids the brand-purple
        // → canary-amber flash when the persisted choice is canary.
        if (!hydrated) {
          return {
            wrap: "border-border bg-surface-1 text-muted-foreground",
            dot: "bg-muted-foreground",
          }
        }
        return chain.isTestnet
          ? {
              wrap: "border-amber-500/40 bg-amber-500/8 text-amber-700 dark:text-amber-400",
              dot: "bg-amber-400",
            }
          : {
              wrap: "border-purple-border bg-primary/5 text-primary",
              dot: "bg-primary",
            }
    }
  })()

  const label = (() => {
    switch (state) {
      case "loading":
        // No chain name until hydration; we won't claim a network we may
        // be about to swap a tick later.
        return hydrated ? `Connecting to ${chain.shortName}…` : "Connecting…"
      case "error":
        return "RPC unreachable - retrying"
      case "idle":
        return "No active referenda right now"
      case "active":
        return `${count} ${count === 1 ? "referendum" : "referenda"} active - vote now`
    }
  })()

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium mb-8",
        tone.wrap,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", tone.dot)} />
      {label}
    </div>
  )
}

"use client"

import { useMemo } from "react"
import Link from "next/link"
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Coins,
  ExternalLink,
  TrendingUp,
  User,
  Wallet,
  XCircle,
} from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { ProposalCard } from "@/components/governance/proposal-card"
import { Bar, ProposalCardSkeleton } from "@/components/governance/skeletons"
import { TopUpTreasuryButton } from "@/components/governance/top-up-treasury-button"
import { subscanAccountUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import {
  formatTokenAmount,
  formatTokenAmountCompact,
  planckToString,
} from "@/lib/chain/format"
import { shortenAddress } from "@/lib/chain/ss58"
import { TREASURY_SPEND_ORIGINS } from "@/lib/governance/treasury"
import { canonicalTrackName } from "@/lib/governance/tracks"
import { useBalance } from "@/lib/query/hooks/use-balance"
import { useMyDrafts } from "@/lib/query/hooks/use-my-drafts"
import { useReferenda } from "@/lib/query/hooks/use-referenda"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useTreasuryTiers } from "@/lib/query/hooks/use-treasury-tiers"
import { useTokenPrice } from "@/lib/query/hooks/use-token-price"
import { useProposalMetadataBatch } from "@/lib/query/hooks/use-proposal-metadata"
import { useWallet } from "@/lib/wallet/use-wallet"

// The tracks the wizard files spends under. Compared in canonical form
// (lowercased, separators stripped) because the runtime serialises track
// names as snake_case (`small_tipper`) while the origin list holds the
// PascalCase variant (`SmallTipper`).
const TREASURY_TRACK_NAMES = new Set(TREASURY_SPEND_ORIGINS.map(canonicalTrackName))

export default function TreasuryPage() {
  const chain = useActiveChain()
  const { activeAddress } = useWallet()
  const balanceQuery = useBalance(chain.treasuryAddress)
  const priceQuery = useTokenPrice()
  const tracksQuery = useTracks()
  const treasuryTiers = useTreasuryTiers()
  const referendaQuery = useReferenda()
  const myDraftsQuery = useMyDrafts(activeAddress, chain)

  const balance = balanceQuery.data ?? null
  const price = priceQuery.data ?? null
  const usdValue =
    balance != null && price != null
      ? Number(planckToString(balance, chain.decimals)) * price
      : null

  // Treasury referenda: filter the live list to only those whose track is
  // one of the treasury tiers (SmallTipper / BigTipper / SmallSpender / …).
  // While tracks are still loading we fall back to showing every referendum
  // - otherwise we'd flash "no treasury requests" against a populated chain.
  const tracksByName = tracksQuery.data ?? []
  const treasuryTrackIds = new Set(
    tracksByName
      .filter((t) => TREASURY_TRACK_NAMES.has(canonicalTrackName(t.name)))
      .map((t) => t.id),
  )
  const trackById = new Map(tracksByName.map((t) => [t.id, t]))
  const allReferenda = referendaQuery.data ?? []
  const tracksReady = !tracksQuery.isPending && tracksByName.length > 0
  const treasuryReferenda = tracksReady
    ? allReferenda.filter(
        (r) => r.trackId != null && treasuryTrackIds.has(r.trackId),
      )
    : allReferenda

  const active = treasuryReferenda.filter((r) => r.status.type === "Ongoing")
  const approved = treasuryReferenda.filter((r) => r.status.type === "Approved")
  const rejected = treasuryReferenda.filter(
    (r) => r.status.type === "Rejected" || r.status.type === "TimedOut",
  )

  // The user's on-chain treasury requests: map their `on_chain` draft rows
  // to the matching referendum so each appears with the same card +
  // lifecycle progress the proposals list uses.
  const myIndices = new Set(
    (myDraftsQuery.data ?? [])
      .filter((d) => d.status === "on_chain" && d.referendum_index != null)
      .map((d) => d.referendum_index as number),
  )
  const myReferenda = treasuryReferenda.filter((r) => myIndices.has(r.index))

  // One round-trip for every card on the page - both the "Your treasury
  // requests" section and the active list pull from the same map.
  const metadataIndices = useMemo(
    () => treasuryReferenda.map((r) => r.index),
    [treasuryReferenda],
  )
  const metadataQuery = useProposalMetadataBatch(metadataIndices)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />

      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-semibold text-foreground mb-2">Treasury</h1>
              <p className="text-muted-foreground">
                Community-governed funding on {chain.name}.
              </p>
            </div>
            <Link
              href="/create"
              className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all duration-200 glow-purple-sm"
            >
              Request Funds
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Balance hero */}
          <div className="rounded-2xl bg-card border border-border p-6 mb-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none translate-x-16 -translate-y-16" />
            <div className="relative space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Treasury balance</p>
                {chain.isTestnet && (
                  <span className="text-[10px] uppercase tracking-wider text-amber-400 border border-amber-500/40 rounded-full px-1.5 py-0.5">
                    Testnet
                  </span>
                )}
              </div>

              {balanceQuery.isPending ? (
                <Bar className="h-9 w-56" inCard={false} />
              ) : balance != null ? (
                <p className="text-2xl sm:text-3xl font-semibold text-foreground tabular-nums">
                  {formatTokenAmount(balance, chain, { maxFractionDigits: 2 })}
                </p>
              ) : (
                <p className="text-2xl font-semibold text-muted-foreground">
                  {balanceQuery.isError ? "Unavailable" : "-"}
                </p>
              )}

              <div className="flex items-center gap-3 text-sm">
                {usdValue != null && (
                  <span className="text-muted-foreground tabular-nums">
                    ≈ ${usdValue.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD
                  </span>
                )}
                {price != null && (
                  <>
                    <span className="text-zinc-500">·</span>
                    <span className="text-muted-foreground tabular-nums">
                      {chain.ticker} ${price.toFixed(4)}
                    </span>
                  </>
                )}
                {chain.coingeckoId == null && (
                  <span className="text-muted-foreground italic">
                    No market price for {chain.ticker}
                  </span>
                )}
              </div>

              <div className="inline-flex items-center gap-1.5 pt-1">
                <a
                  href={subscanAccountUrl(chain, chain.treasuryAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
                >
                  {shortenAddress(chain.treasuryAddress)}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <TopUpTreasuryButton chain={chain} />
              </div>
            </div>
          </div>

          {/* Live stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            <StatCard
              label="Active requests"
              icon={Clock}
              value={referendaQuery.isPending ? null : String(active.length)}
            />
            <StatCard
              label="Approved"
              icon={CheckCircle2}
              value={referendaQuery.isPending ? null : String(approved.length)}
            />
            <StatCard
              label="Rejected"
              icon={XCircle}
              value={referendaQuery.isPending ? null : String(rejected.length)}
            />
            <StatCard
              label="Total tracked"
              icon={TrendingUp}
              value={referendaQuery.isPending ? null : String(treasuryReferenda.length)}
            />
          </div>

          {/* Your treasury requests - only shown when there is at least one. */}
          {activeAddress && myReferenda.length > 0 && (
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-foreground flex items-center gap-2">
                  <User className="w-4 h-4 text-primary" />
                  Your treasury requests
                </h2>
                <Link
                  href="/account"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  Account
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {myReferenda.map((r) => (
                  <ProposalCard
                    key={r.index}
                    referendum={r}
                    track={r.trackId != null ? trackById.get(r.trackId) : null}
                    metadata={metadataQuery.data?.get(r.index) ?? null}
                    metadataPending={metadataQuery.isLoading}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Active requests */}
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-400" />
                Active treasury requests
              </h2>
              <Link
                href="/proposals"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                All proposals
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {referendaQuery.isPending || tracksQuery.isPending ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ProposalCardSkeleton />
                <ProposalCardSkeleton />
              </div>
            ) : active.length === 0 ? (
              <div className="rounded-2xl bg-card border border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No active treasury requests right now.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {active.map((r) => (
                  <ProposalCard
                    key={r.index}
                    referendum={r}
                    track={r.trackId != null ? trackById.get(r.trackId) : null}
                    metadata={metadataQuery.data?.get(r.index) ?? null}
                    metadataPending={metadataQuery.isLoading}
                  />
                ))}
              </div>
            )}
          </section>

          {/* How the treasury works */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-card border border-border p-6 space-y-3">
              <h2 className="font-semibold text-foreground">How the treasury works</h2>
              <ul className="text-sm text-muted-foreground leading-relaxed space-y-2 list-disc list-inside">
                <li>
                  ENJ accumulates in the treasury account from inflation,
                  slashes, and unused fees.
                </li>
                <li>
                  Anyone can submit a treasury request by referendum - the
                  call is a <code className="font-mono text-foreground">treasury.spend_local</code>{" "}
                  wrapped in a preimage and submitted via{" "}
                  <code className="font-mono text-foreground">referenda.submit</code>.
                </li>
                <li>
                  Submission reserves a small refundable deposit; the per-track
                  decision deposit is larger and also refundable on outcome.
                  Both amounts are read live from the chain on each proposal.
                </li>
                <li>
                  Approved spends are paid to the beneficiary automatically
                  at the treasury&apos;s next spend period after enactment,
                  once the treasury holds enough to cover them.
                </li>
              </ul>
            </div>

            <div className="rounded-2xl bg-card border border-border p-6 space-y-3">
              <h2 className="font-semibold text-foreground">Spend tiers</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pick the smallest tier that covers your request - the wizard
                does this automatically based on the amount.
              </p>
              <ul className="text-xs font-mono space-y-1.5 pt-2 border-t border-border">
                {TREASURY_SPEND_ORIGINS.map((origin) => {
                  const tier = treasuryTiers.table?.tiers.find((t) => t.origin === origin)
                  return (
                    <li key={origin} className="flex justify-between">
                      <span className="text-foreground">{origin}</span>
                      <span className="text-muted-foreground">
                        {!tier
                          ? "-"
                          : tier.maxAmount == null
                            ? "≤ ∞"
                            : `≤ ${formatTokenAmountCompact(tier.maxAmount, chain)}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {treasuryTiers.notice && (
                <p className="text-[11px] text-amber-300 leading-relaxed">
                  {treasuryTiers.notice}
                </p>
              )}
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  )
}

function StatCard({
  label,
  icon: Icon,
  value,
}: {
  label: string
  icon: typeof Clock
  value: string | null
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-4 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        {value == null ? (
          <Bar className="h-6 w-12" inCard={false} />
        ) : (
          <p className="text-lg font-semibold text-foreground tabular-nums">{value}</p>
        )}
        <p className="text-xs text-muted-foreground truncate">{label}</p>
      </div>
    </div>
  )
}


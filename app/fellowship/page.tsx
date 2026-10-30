"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, FileText, Search, ShieldCheck, Users } from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { LoadError } from "@/components/layout/load-error"
import { Bar } from "@/components/governance/skeletons"
import { FellowshipReferendumCard } from "@/components/fellowship/fellowship-referendum-card"
import { MembersList } from "@/components/fellowship/members-list"
import { WhitelistList } from "@/components/fellowship/whitelist-list"
import { FELLOWSHIP_PALLET, rankName, rankNumeral } from "@/lib/governance/fellowship"
import { useNetworkParam } from "@/lib/chain/use-network-param"
import { useActiveChain, useChainHydrated } from "@/lib/chain/use-chain"
import {
  useFellowshipMembers,
  useFellowshipReferenda,
  useFellowshipTracks,
  useHasFellowship,
  useMyRank,
} from "@/lib/query/hooks/use-fellowship"
import { useWhitelistCount, useWhitelistedCalls } from "@/lib/query/hooks/use-whitelist"
import { useProposalMetadataBatch } from "@/lib/query/hooks/use-proposal-metadata"
import { useWallet } from "@/lib/wallet/use-wallet"
import { friendlyError } from "@/lib/utils/format-error"
import { cn } from "@/lib/utils"

type Tab = "referenda" | "members" | "whitelist"

const TABS: { id: Tab; label: string }[] = [
  { id: "referenda", label: "Referenda" },
  { id: "members", label: "Members" },
  { id: "whitelist", label: "Whitelist" },
]

export default function FellowshipPage() {
  useNetworkParam()
  const chain = useActiveChain()
  const hydrated = useChainHydrated()
  const has = useHasFellowship()
  const { activeAddress, status: walletStatus } = useWallet()
  const membersQuery = useFellowshipMembers()
  const referendaQuery = useFellowshipReferenda()
  const tracksQuery = useFellowshipTracks()
  const whitelistQuery = useWhitelistedCalls()
  const whitelistCount = useWhitelistCount()
  const { rank } = useMyRank(activeAddress)
  const [tab, setTab] = useState<Tab>("referenda")
  const [search, setSearch] = useState("")

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data])
  const referenda = useMemo(() => referendaQuery.data ?? [], [referendaQuery.data])
  const tracks = tracksQuery.data ?? []
  const active = referenda.filter((r) => r.status.type === "Ongoing")
  const deciding = active.filter(
    (r) => r.status.type === "Ongoing" && r.status.deciding != null,
  ).length
  const rankSummary = useMemo(() => {
    const byRank = new Map<number, number>()
    for (const m of members) byRank.set(m.rank, (byRank.get(m.rank) ?? 0) + 1)
    return [...byRank.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2)
      .map(([r, n]) => `${n} ${rankName(r)}${n === 1 ? "" : "s"}`)
      .join(" · ")
  }, [members])
  const whitelistedCount = whitelistCount.data ?? null

  // Their EGOV1 titles, for the cards and the search.
  const indices = useMemo(() => referenda.map((r) => r.index), [referenda])
  const metadataQuery = useProposalMetadataBatch(indices, undefined, FELLOWSHIP_PALLET)
  const shown = useMemo(() => {
    const raw = search.trim().toLowerCase()
    if (!raw) return referenda
    const q = raw.replace(/^f\s*#\s*/, "")
    return referenda.filter((r) => {
      if (String(r.index) === q) return true
      const m = metadataQuery.data?.get(r.index)
      return [m?.title ?? "", m?.summary ?? ""].join("\n").toLowerCase().includes(raw)
    })
  }, [referenda, search, metadataQuery.data])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-2xl">
              <h1 className="text-3xl font-semibold text-foreground mb-2">Fellowship</h1>
              <p className="text-muted-foreground">
                The ranked technical collective of the {hydrated ? chain.name : "Enjin Relaychain"}.
                Members vote by rank; an approved call runs with a Fellowship origin, such as
                whitelisting a call for the fast public track.
              </p>
            </div>
            {has && (
              <Link
                href={`/create/advanced?chamber=fellowship&network=${chain.id}`}
                className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all duration-200 glow-purple-sm"
              >
                New referendum
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>

          {has === false ? (
            <p className="text-sm text-muted-foreground">This network has no Fellowship.</p>
          ) : membersQuery.isError || referendaQuery.isError ? (
            <LoadError
              {...friendlyError(membersQuery.error ?? referendaQuery.error)}
              retry={() => {
                void membersQuery.refetch()
                void referendaQuery.refetch()
              }}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
                <StatCard
                  icon={<Users className="w-3.5 h-3.5" />}
                  label="Members"
                  value={membersQuery.isPending ? null : String(members.length)}
                  sub={membersQuery.isPending ? undefined : rankSummary || "No members yet"}
                />
                <StatCard
                  icon={<FileText className="w-3.5 h-3.5" />}
                  label="Active referenda"
                  value={referendaQuery.isPending ? null : String(active.length)}
                  sub={
                    referendaQuery.isPending
                      ? undefined
                      : active.length
                        ? `${deciding} deciding · ${active.length - deciding} preparing`
                        : `${referenda.length} in total`
                  }
                />
                <StatCard
                  icon={<ShieldCheck className="w-3.5 h-3.5" />}
                  label="Whitelisted calls"
                  value={whitelistedCount == null ? null : String(whitelistedCount)}
                  sub={
                    whitelistedCount == null
                      ? undefined
                      : whitelistedCount
                        ? "Waiting for a public vote"
                        : "None waiting"
                  }
                />
                <div className="rounded-2xl bg-card border border-border p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">You</p>
                  {rank != null ? (
                    <>
                      <p className="text-2xl font-semibold text-primary mt-1">
                        Rank {rankNumeral(rank)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {rankName(rank)} · votes on tracks 0-{rank}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-semibold text-foreground mt-1">
                        {walletStatus === "connected" ? "No rank" : "Visitor"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {walletStatus === "connected" ? "Not a member" : "Connect to see your rank"}
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div className="flex gap-1" role="tablist">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                      className={cn(
                        "px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors",
                        tab === t.id
                          ? "bg-surface-2 text-foreground border border-border"
                          : "text-muted-foreground hover:text-foreground border border-transparent",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {tab === "referenda" && (
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search F# or title…"
                      className="w-full pl-10 pr-4 py-2 rounded-xl bg-surface-1 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                )}
              </div>

              {tab === "referenda" ? (
                referendaQuery.isPending ? (
                  <div className="grid sm:grid-cols-2 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Bar key={i} className="h-36 rounded-2xl" />
                    ))}
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      {shown.length} fellowship referend{shown.length === 1 ? "um" : "a"}
                    </p>
                    {shown.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {referenda.length === 0
                          ? `No fellowship referendum on ${chain.name} yet.`
                          : "Nothing matches that search."}
                      </p>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-3">
                        {shown.map((r) => (
                          <FellowshipReferendumCard
                            key={r.index}
                            referendum={r}
                            tracks={tracks}
                            myAddress={activeAddress ?? null}
                            myRank={rank}
                            title={metadataQuery.data?.get(r.index)?.title ?? null}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )
              ) : tab === "members" ? (
                membersQuery.isPending ? (
                  <Bar className="h-64 rounded-2xl" />
                ) : (
                  <MembersList members={members} tracks={tracks} me={activeAddress ?? null} />
                )
              ) : (
                <WhitelistList query={whitelistQuery} />
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  sub?: string
}) {
  return (
    <div className="rounded-2xl bg-card border border-border p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      {value == null ? (
        <Bar className="h-7 w-10 mt-1.5" />
      ) : (
        <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
      )}
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

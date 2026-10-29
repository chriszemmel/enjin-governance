"use client"

import { useMemo, useState } from "react"
import { FileText, ShieldCheck, Users } from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { LoadError } from "@/components/layout/load-error"
import { Bar } from "@/components/governance/skeletons"
import { FellowshipReferendumCard } from "@/components/fellowship/fellowship-referendum-card"
import { MembersList } from "@/components/fellowship/members-list"
import { RankBadge } from "@/components/fellowship/rank-badge"
import { rankName } from "@/lib/governance/fellowship"
import { useActiveChain, useChainHydrated } from "@/lib/chain/use-chain"
import {
  useFellowshipMembers,
  useFellowshipReferenda,
  useFellowshipTracks,
  useHasFellowship,
  useMyRank,
} from "@/lib/query/hooks/use-fellowship"
import { useWallet } from "@/lib/wallet/use-wallet"
import { friendlyError } from "@/lib/utils/format-error"
import { cn } from "@/lib/utils"

type Tab = "referenda" | "members"

export default function FellowshipPage() {
  const chain = useActiveChain()
  const hydrated = useChainHydrated()
  const has = useHasFellowship()
  const { activeAddress } = useWallet()
  const membersQuery = useFellowshipMembers()
  const referendaQuery = useFellowshipReferenda()
  const tracksQuery = useFellowshipTracks()
  const { rank } = useMyRank(activeAddress)
  const [tab, setTab] = useState<Tab>("referenda")

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data])
  const referenda = referendaQuery.data ?? []
  const tracks = tracksQuery.data ?? []
  const active = referenda.filter((r) => r.status.type === "Ongoing")
  const rankSummary = useMemo(() => {
    const byRank = new Map<number, number>()
    for (const m of members) byRank.set(m.rank, (byRank.get(m.rank) ?? 0) + 1)
    return [...byRank.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2)
      .map(([r, n]) => `${n} ${rankName(r)}${n === 1 ? "" : "s"}`)
      .join(" · ")
  }, [members])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold text-foreground mb-2">Fellowship</h1>
            <p className="text-muted-foreground max-w-2xl">
              The ranked technical collective of the {hydrated ? chain.name : "Enjin Relaychain"}.
              Members vote by rank; an approved call runs with a Fellowship origin, such as
              whitelisting a call for the fast public track.
            </p>
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
                  sub={rankSummary}
                />
                <StatCard
                  icon={<FileText className="w-3.5 h-3.5" />}
                  label="Active referenda"
                  value={referendaQuery.isPending ? null : String(active.length)}
                  sub={`${referenda.length} in total`}
                />
                <StatCard
                  icon={<ShieldCheck className="w-3.5 h-3.5" />}
                  label="Tracks"
                  value={tracksQuery.isPending ? null : String(tracks.length)}
                  sub="Rank 0 to IX"
                />
                <div className="rounded-2xl bg-card border border-border p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">You</p>
                  <div className="mt-1.5">
                    {rank != null ? (
                      <RankBadge rank={rank} className="text-xs" />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {activeAddress ? "Not a member" : "Not connected"}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-1 mb-4" role="tablist">
                {(["referenda", "members"] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                      tab === t
                        ? "bg-surface-2 text-foreground border border-border"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t === "referenda" ? "Referenda" : "Members"}
                  </button>
                ))}
              </div>

              {tab === "referenda" ? (
                referendaQuery.isPending ? (
                  <div className="grid sm:grid-cols-2 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Bar key={i} className="h-28 rounded-2xl" />
                    ))}
                  </div>
                ) : referenda.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No fellowship referendum on {chain.name} yet.
                  </p>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-3">
                    {referenda.map((r) => (
                      <FellowshipReferendumCard
                        key={r.index}
                        referendum={r}
                        track={tracks.find((t) => t.id === r.trackId) ?? null}
                      />
                    ))}
                  </div>
                )
              ) : membersQuery.isPending ? (
                <Bar className="h-64 rounded-2xl" />
              ) : (
                <MembersList members={members} tracks={tracks} me={activeAddress ?? null} />
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
        <Bar className="h-6 w-10 mt-1.5" />
      ) : (
        <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
      )}
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

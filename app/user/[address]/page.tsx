"use client"

import { use } from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle2, ExternalLink, User } from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { Avatar } from "@/components/account/avatar"
import { usePublicProfile } from "@/lib/query/hooks/use-profile"
import { useMyDrafts } from "@/lib/query/hooks/use-my-drafts"
import { useActiveChain } from "@/lib/chain/use-chain"
import { shortenAddress } from "@/lib/chain/ss58"

export default function UserPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = use(params)
  const chain = useActiveChain()
  const profile = usePublicProfile(address)
  const drafts = useMyDrafts(address, chain)
  const proposals = (drafts.data ?? []).filter((d) => d.referendum_index != null)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-2xl mx-auto space-y-6">
          <section className="rounded-2xl bg-card border border-border p-6 flex items-start gap-5">
            <Avatar
              url={profile.data?.avatar_url}
              address={address}
              fallback={
                profile.data?.display_name ??
                profile.data?.handle ??
                address
              }
              size="xl"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold text-foreground truncate">
                  {profile.data?.display_name ??
                    (profile.data?.handle
                      ? `@${profile.data.handle}`
                      : shortenAddress(address))}
                </h1>
                {profile.data?.is_verified && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary"
                    title="Verified"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Verified
                  </span>
                )}
              </div>
              {profile.data?.handle && profile.data?.display_name && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  @{profile.data.handle}
                </p>
              )}
              <p className="text-[11px] font-mono text-muted-foreground mt-1 break-all">
                {address}
              </p>
              {profile.data?.bio && (
                <p className="mt-3 text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {profile.data.bio}
                </p>
              )}
              {!profile.data && !profile.isPending && (
                <p className="text-xs text-muted-foreground mt-3 inline-flex items-center gap-1.5">
                  <User className="w-3 h-3" />
                  No profile yet for this address.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl bg-card border border-border p-6">
            <h2 className="text-sm font-semibold text-foreground mb-3">
              On-chain proposals
              <span className="text-xs text-muted-foreground font-normal ml-2">
                {proposals.length}
              </span>
            </h2>
            {drafts.isPending ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : proposals.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                None on {chain.shortName} yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {proposals.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-surface-1 border border-border"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {d.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        #{d.referendum_index} · {d.status}
                      </p>
                    </div>
                    <Link
                      href={`/proposals/${d.referendum_index}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-[11px] text-muted-foreground text-center">
            Drafts that never landed on chain are hidden here.{" "}
            <a
              href={`https://canary.subscan.io/account/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-purple-dim inline-flex items-center gap-0.5"
            >
              Open on Subscan
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}

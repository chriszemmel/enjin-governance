"use client"

import Link from "next/link"
import { ArrowRight, ShieldCheck } from "lucide-react"
import type { UseQueryResult } from "@tanstack/react-query"
import { Bar } from "@/components/governance/skeletons"
import { useActiveChain } from "@/lib/chain/use-chain"
import type { WhitelistCounterpart } from "@/lib/governance/whitelist"

type Entry = {
  hash: `0x${string}`
  fellowship: WhitelistCounterpart[]
  dispatch: WhitelistCounterpart[]
}

const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`

/**
 * The calls the Fellowship has whitelisted and nobody has dispatched yet:
 * each one's hash, the F# that whitelisted it and the public referendum
 * that may dispatch it on the WhitelistedCaller track.
 */
export function WhitelistList({ query }: { query: UseQueryResult<Entry[]> }) {
  const chain = useActiveChain()
  if (query.isPending) return <Bar className="h-32 rounded-2xl" />
  const entries = query.data ?? []
  if (entries.length === 0) {
    return (
      <div className="rounded-2xl bg-card border border-border p-5 text-sm text-muted-foreground leading-relaxed">
        No call is whitelisted right now. When a fellowship referendum that whitelists a call
        passes, the call waits here until a public WhitelistedCaller referendum dispatches it.
      </div>
    )
  }
  return (
    <ul className="space-y-3">
      {entries.map((e) => {
        const f = e.fellowship[0]
        const p = e.dispatch[0]
        return (
          <li key={e.hash} className="rounded-2xl bg-card border border-border p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
              <p className="font-mono text-sm text-foreground" title={e.hash}>
                {short(e.hash)}
              </p>
              <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full border border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400">
                Whitelisted
              </span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs">
              <Row
                label="Whitelisted by"
                link={
                  f
                    ? { href: `/fellowship/${f.index}?network=${chain.id}`, text: `F#${f.index}` }
                    : null
                }
                empty="A fellowship referendum"
              />
              <Row
                label="Public vote"
                link={
                  p
                    ? {
                        href: `/proposals/${p.index}?network=${chain.id}`,
                        text: `Referendum #${p.index} · Whitelisted Caller`,
                      }
                    : null
                }
                empty="Not filed yet"
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Row({
  label,
  link,
  empty,
}: {
  label: string
  link: { href: string; text: string } | null
  empty: string
}) {
  return (
    <div className="rounded-xl bg-surface-1 border border-border px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {link ? (
        <Link
          href={link.href}
          className="inline-flex items-center gap-1 text-primary font-medium mt-0.5"
        >
          {link.text} <ArrowRight className="w-3 h-3" />
        </Link>
      ) : (
        <p className="text-muted-foreground mt-0.5">{empty}</p>
      )}
    </div>
  )
}

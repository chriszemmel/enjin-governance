"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { FellowshipChamber } from "@/components/fellowship/fellowship-chamber"
import { MIN_SUBMIT_RANK, rankNumeral } from "@/lib/governance/fellowship"
import { useNetworkParam } from "@/lib/chain/use-network-param"
import { useActiveChain } from "@/lib/chain/use-chain"

export default function NewFellowshipReferendumPage() {
  useNetworkParam()
  const chain = useActiveChain()
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-2xl mx-auto space-y-6">
          <Link
            href={`/fellowship?network=${chain.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Fellowship
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">New fellowship referendum</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Members of rank {rankNumeral(MIN_SUBMIT_RANK)} and up may file. The origin sets the
              track and who may vote.
            </p>
          </div>
          <FellowshipChamber />
        </div>
      </main>
      <Footer />
    </div>
  )
}

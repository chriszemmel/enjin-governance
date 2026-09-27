"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Search, SlidersHorizontal } from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { LoadError } from "@/components/layout/load-error"
import { ProposalCard } from "@/components/governance/proposal-card"
import { Bar, ProposalCardSkeleton } from "@/components/governance/skeletons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { friendlyError } from "@/lib/utils/format-error"
import { cn } from "@/lib/utils"
import { useActiveChain, useChainHydrated } from "@/lib/chain/use-chain"
import { useReferenda } from "@/lib/query/hooks/use-referenda"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useProposalMetadataBatch } from "@/lib/query/hooks/use-proposal-metadata"
import { statusLabel } from "@/lib/governance/display"
import type { ReferendumStatusType, Track } from "@/lib/governance/types"

const PAGE_SIZE = 10

// Surface the outcomes users actually care about. Tracks intentionally
// excluded - they're an implementation detail of OpenGov, not how someone
// browsing proposals thinks. The track is still shown on each card.
const STATUS_FILTERS: { label: string; value: ReferendumStatusType | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "Ongoing" },
  { label: "Approved", value: "Approved" },
  { label: "Rejected", value: "Rejected" },
  { label: "Cancelled", value: "Cancelled" },
  { label: "Timed out", value: "TimedOut" },
]

type SortOrder = "newest" | "oldest"
const SORT_OPTIONS: { label: string; value: SortOrder }[] = [
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
]

export default function ProposalsPage() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<ReferendumStatusType | "all">("all")
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest")
  const [page, setPage] = useState(1)

  const chain = useActiveChain()
  const chainHydrated = useChainHydrated()
  const referendaQuery = useReferenda()
  const tracksQuery = useTracks()

  const filtersActive = status !== "all" || sortOrder !== "newest"

  // Any filter/search change collapses the result set; jumping back to
  // page 1 is the only safe default so a search on page 4 doesn't show
  // an empty page when only 2 results match.
  useEffect(() => {
    setPage(1)
  }, [search, status, sortOrder])

  const trackById = useMemo(() => {
    const map = new Map<number, Track>()
    if (tracksQuery.data) for (const t of tracksQuery.data) map.set(t.id, t)
    return map
  }, [tracksQuery.data])

  // Batch metadata for every referendum once, not on each filter change,
  // so changing the status filter is instant and stays cached. Also
  // backs the title/summary/body keyword search below.
  const allIndices = useMemo(
    () => (referendaQuery.data ?? []).map((r) => r.index),
    [referendaQuery.data],
  )
  const metadataQuery = useProposalMetadataBatch(allIndices)

  const filtered = useMemo(() => {
    const all = referendaQuery.data ?? []
    const q = search.trim().toLowerCase()
    const matched = all.filter((ref) => {
      if (status !== "all" && ref.status.type !== status) return false
      if (!q) return true
      // Search across the on-chain index AND the off-chain metadata
      // (title / summary / body_markdown) so phrases the proposer used
      // - "EGOV1", a beneficiary name, a tier - match even when the
      // user doesn't know the referendum number.
      const meta = metadataQuery.data?.get(ref.index) ?? null
      const haystack = [
        String(ref.index),
        `#${ref.index}`,
        `referendum #${ref.index}`,
        meta?.title ?? "",
        meta?.summary ?? "",
        meta?.body_markdown ?? "",
        meta?.proposer_address ?? "",
      ]
        .join("\n")
        .toLowerCase()
      return haystack.includes(q)
    })
    // Sort by referendum index - higher = newer since OpenGov assigns
    // them monotonically per submission.
    const sorted = [...matched].sort((a, b) =>
      sortOrder === "newest" ? b.index - a.index : a.index - b.index,
    )
    return sorted
  }, [referendaQuery.data, search, status, sortOrder, metadataQuery.data])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // Guard against a transient stale state (e.g. data refetch shrank the
  // total) where the persisted page would be out of bounds.
  const safePage = Math.min(page, pageCount)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const pageNumbers = useMemo(
    () => buildPageList(safePage, pageCount),
    [safePage, pageCount],
  )

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />

      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-semibold text-foreground mb-2">Proposals</h1>
              <p className="text-muted-foreground">
                {chainHydrated
                  ? `Live referenda from the ${chain.name} - browse without connecting a wallet.`
                  : "Live referenda - browse without connecting a wallet."}
              </p>
            </div>
            <Link
              href="/create"
              className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all duration-200 glow-purple-sm"
            >
              Create Proposal
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="flex items-center gap-2 mb-8">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search proposals…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-1 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "relative flex-shrink-0 inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors",
                    filtersActive
                      ? "border-purple-border bg-primary/8 text-primary"
                      : "border-border bg-surface-1 text-foreground hover:bg-surface-2",
                  )}
                  aria-label="Filter and sort proposals"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  <span className="hidden sm:inline">Filter & Sort</span>
                  {filtersActive && (
                    <span
                      aria-hidden
                      className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary"
                    />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-64 p-3 bg-card border-border"
              >
                <div className="space-y-4">
                  <FilterSection
                    label="Status"
                    options={STATUS_FILTERS}
                    value={status}
                    onChange={setStatus}
                  />
                  <div className="h-px bg-border" />
                  <FilterSection
                    label="Sort by"
                    options={SORT_OPTIONS}
                    value={sortOrder}
                    onChange={setSortOrder}
                  />
                  {filtersActive && (
                    <>
                      <div className="h-px bg-border" />
                      <button
                        type="button"
                        onClick={() => {
                          setStatus("all")
                          setSortOrder("newest")
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Reset to defaults
                      </button>
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {referendaQuery.isPending ? (
            <>
              <Bar className="h-4 w-32 mb-4" inCard={false} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <ProposalCardSkeleton key={i} />
                ))}
              </div>
            </>
          ) : referendaQuery.isError ? (
            (() => {
              const err = friendlyError(referendaQuery.error)
              return (
                <LoadError
                  headline={err.headline}
                  detail={err.detail}
                  technical={err.technical}
                  retry={() => referendaQuery.refetch()}
                  card={false}
                />
              )
            })()
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-4">
                {filtered.length === 0
                  ? `0 of ${referendaQuery.data?.length ?? 0} referenda`
                  : `${pageStart + 1}-${pageStart + pageItems.length} of ${filtered.length} referenda`}
                {status !== "all" && ` · ${statusLabel(status)}`}
              </p>
              {filtered.length === 0 ? (
                <div className="py-24 text-center">
                  <p className="text-muted-foreground">No referenda match your filters.</p>
                </div>
              ) : (
                <>
                  {/* The cards' titles are h3s; this names the list above them. */}
                  <h2 className="sr-only">Referenda</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pageItems.map((ref) => (
                      <ProposalCard
                        key={ref.index}
                        referendum={ref}
                        track={ref.trackId != null ? trackById.get(ref.trackId) : null}
                        metadata={metadataQuery.data?.get(ref.index) ?? null}
                        metadataPending={metadataQuery.isLoading}
                      />
                    ))}
                  </div>

                  {pageCount > 1 && (
                    <Pagination className="mt-8">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            href="#"
                            aria-disabled={safePage === 1}
                            className={cn(
                              safePage === 1 &&
                                "pointer-events-none opacity-50",
                            )}
                            onClick={(e) => {
                              e.preventDefault()
                              if (safePage > 1) setPage(safePage - 1)
                            }}
                          />
                        </PaginationItem>
                        {pageNumbers.map((p, i) =>
                          p === "ellipsis" ? (
                            <PaginationItem key={`ellipsis-${i}`}>
                              <PaginationEllipsis />
                            </PaginationItem>
                          ) : (
                            <PaginationItem key={p}>
                              <PaginationLink
                                href="#"
                                isActive={p === safePage}
                                onClick={(e) => {
                                  e.preventDefault()
                                  setPage(p)
                                }}
                              >
                                {p}
                              </PaginationLink>
                            </PaginationItem>
                          ),
                        )}
                        <PaginationItem>
                          <PaginationNext
                            href="#"
                            aria-disabled={safePage === pageCount}
                            className={cn(
                              safePage === pageCount &&
                                "pointer-events-none opacity-50",
                            )}
                            onClick={(e) => {
                              e.preventDefault()
                              if (safePage < pageCount) setPage(safePage + 1)
                            }}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}

/**
 * Compute the visible page items for the pagination strip. Always shows
 * first + last and a one-page window around the current page; collapses
 * the rest into `"ellipsis"` so the row stays compact on every viewport.
 *
 *   1 ... 4 5 6 ... 10
 *
 * For ≤ 7 pages we render every number - no benefit to ellipsis.
 */
function buildPageList(
  current: number,
  total: number,
): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: Array<number | "ellipsis"> = [1]
  const windowStart = Math.max(2, current - 1)
  const windowEnd = Math.min(total - 1, current + 1)
  if (windowStart > 2) out.push("ellipsis")
  for (let i = windowStart; i <= windowEnd; i++) out.push(i)
  if (windowEnd < total - 1) out.push("ellipsis")
  out.push(total)
  return out
}

/**
 * Single-select radio list, shared between the Status and Sort sections
 * inside the Filter & Sort popover. Picking an option updates the parent
 * state immediately - the popover stays open so the user can adjust both
 * filters before closing.
 */
function FilterSection<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: ReadonlyArray<{ label: string; value: T }>
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-medium px-1">
        {label}
      </p>
      <div className="space-y-0.5">
        {options.map((o) => {
          const active = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                active
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0",
                  active ? "border-primary" : "border-border",
                )}
                aria-hidden
              >
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </span>
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

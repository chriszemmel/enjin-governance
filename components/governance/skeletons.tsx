import { cn } from "@/lib/utils"

/**
 * Loading skeletons that mirror the real content's geometry. Every
 * placeholder block lives here so we can keep the animation timing,
 * radius, and surface tones consistent across the app.
 *
 * Design rules:
 *   - All animation goes through `animate-pulse` on the container so
 *     adjacent blocks shimmer in sync.
 *   - Use `bg-surface-2` for blocks inside a card, `bg-surface-3` for
 *     blocks on the page background.
 *   - Rounded radii match the real component: pills → full, lines → md,
 *     cards → 2xl.
 */

export function Bar({
  className,
  inCard = true,
}: {
  className?: string
  inCard?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-md",
        inCard ? "bg-surface-3" : "bg-surface-2",
        className,
      )}
    />
  )
}

function Pill({ className }: { className?: string }) {
  return <div className={cn("rounded-full bg-surface-3", className)} />
}

/**
 * Mirrors a `<ProposalCard>`. Matches only the elements every card always
 * shows - status + track pills, the index, the title (up to two lines), and
 * the submitted-time footer. The tally bar and lifecycle row are conditional
 * (ongoing referenda only), so the skeleton omits them rather than render
 * phantom blocks that vanish on terminal cards.
 */
export function ProposalCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5 animate-pulse",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Pill className="h-5 w-16" />
          <Pill className="h-5 w-20" />
        </div>
        <Bar className="h-4 w-10" />
      </div>

      <div className="space-y-2 mb-3">
        <Bar className="h-5 w-3/4" />
        <Bar className="h-5 w-1/2" />
      </div>

      <Bar className="h-3 w-32" />
    </div>
  )
}

/**
 * Mirrors the proposal detail page below its header card - tally card,
 * votes card, deposits card, preimage card - while the referendum is read
 * from the chain. The header card itself renders at once (it has its own
 * placeholders for the chain parts), so its text never moves when the
 * rest arrives. Pair with `VotePanelSkeleton` in the sidebar.
 */
export function ProposalDetailBodySkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <TallyCardSkeleton />
      <VotesCardSkeleton />
      <DepositsCardSkeleton />
      <PreimageCardSkeleton />
    </div>
  )
}

function TallyCardSkeleton() {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Bar className="h-5 w-16" />
        <Bar className="h-3 w-10" />
      </div>
      <Bar className="h-3 w-44" />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Bar className="h-4 w-12" />
            <Bar className="h-4 w-12" />
          </div>
          <Bar className="h-3 w-32" />
          <Bar className="h-2 w-full rounded-full" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Bar className="h-4 w-12" />
            <Bar className="h-4 w-12" />
          </div>
          <Bar className="h-3 w-24" />
          <Bar className="h-2 w-full rounded-full" />
        </div>
      </div>
      <div className="pt-4 border-t border-border space-y-2">
        <div className="flex items-center justify-between">
          <Bar className="h-3 w-24" />
          <Bar className="h-3 w-20" />
        </div>
        <Bar className="h-3 w-3/4" />
      </div>
    </div>
  )
}

function VotesCardSkeleton() {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 space-y-5">
      <div className="flex items-center justify-between">
        <Bar className="h-5 w-14" />
        <Bar className="h-3 w-10" />
      </div>
      <div className="space-y-3">
        <Bar className="h-3 w-32" />
        <Bar className="h-3 w-full rounded-full" />
        <div className="grid grid-cols-7 gap-2 pt-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <Bar key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
      <div className="space-y-1.5 pt-4 border-t border-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

function DepositsCardSkeleton() {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 space-y-4">
      <Bar className="h-5 w-20" />
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Bar className="h-3 w-28" />
          <Bar className="h-5 w-20" />
          <Bar className="h-3 w-32" />
        </div>
        <div className="space-y-1.5">
          <Bar className="h-3 w-24" />
          <Bar className="h-5 w-16" />
        </div>
      </div>
    </div>
  )
}

function PreimageCardSkeleton() {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 space-y-3">
      <Bar className="h-5 w-24" />
      <Bar className="h-12 w-full" />
      <Bar className="h-3 w-3/4" />
    </div>
  )
}

/** The "cast your vote" sidebar while the referendum loads. */
export function VotePanelSkeleton() {
  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden animate-pulse">
      <div className="px-5 py-4 border-b border-border">
        <Bar className="h-4 w-24 mb-2" />
        <Bar className="h-3 w-40" />
      </div>
      <div className="p-5 space-y-3">
        <Bar className="h-10 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-2">
          <Bar className="h-12 w-full rounded-xl" />
          <Bar className="h-12 w-full rounded-xl" />
        </div>
        <Bar className="h-10 w-full rounded-xl" />
        <Bar className="h-12 w-full rounded-xl" />
        <Bar className="h-12 w-full rounded-xl" />
      </div>
    </div>
  )
}

/** Inline placeholder used inside the preimage / call card while we
 *  resolve the decoded call. Sized to fit the actual call display
 *  (one row for module.method, two for the arguments breakdown). */
export function PreimageInlineSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <Bar className="h-12 w-full rounded-lg" />
      <Bar className="h-20 w-full rounded-lg" />
    </div>
  )
}

"use client"

import { useMemo, useRef, useState } from "react"
import { CheckCircle2, ChevronDown, Clock, Loader2, PauseCircle, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChainConfig } from "@/lib/chain/chains"
import { blocksToSeconds, blockToDate, formatTokenAmount } from "@/lib/chain/format"
import { evaluateCurve, sampleCurve } from "@/lib/governance/curves"
import type {
  GovernanceCurve,
  Referendum,
  Tally,
  Track,
} from "@/lib/governance/types"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import type { SupportBasis } from "@/lib/governance/support"
import { useSupportIssuance } from "@/lib/query/hooks/use-support-issuance"
import { useUndecidingTimeout } from "@/lib/query/hooks/use-undeciding-timeout"
import { computeVerdict } from "@/lib/governance/verdict"
import { type VerdictCopy, type VerdictTone, verdictCopy } from "@/lib/governance/verdict-copy"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface DecisionSlideProps {
  referendum: Referendum
  track: Track | null
  tally: Tally | null
  chain: ChainConfig
}

/** How a single requirement chart reads: met, on its way, out of reach, or not counting yet. */
type ChartTone = "pass" | "course" | "short" | "idle"

/**
 * "Decision" slide: is this referendum meeting its two thresholds right
 * now, and how do the decaying requirements compare to where it stands?
 *
 *   - Approval = ayes / (ayes + nays), conviction-weighted (from the tally).
 *   - Support  = tally.support / the runtime's turnout denominator: active
 *     issuance (total - inactive) before spec 1080, total issuance from it
 *     (lib/governance/support.ts).
 *
 * Both are checked against the track's decaying requirement curves at
 * today's point in the decision period. The verdict (lib/governance/verdict.ts)
 * mirrors the runtime: it only warns when today's votes can't meet the curves
 * before the decision period ends, and a tap on it explains why. The chart
 * renders the actual trajectory
 * as a flat line at the current value (chain state only) - plotted history
 * would need per-block tally points, later via the Subscan client.
 */
export function DecisionSlide({
  referendum,
  track,
  tally,
  chain,
}: DecisionSlideProps) {
  const currentBlockQuery = useCurrentBlock(chain)
  const issuanceQuery = useSupportIssuance(chain)
  const timeoutQuery = useUndecidingTimeout(chain)
  const currentBlock = currentBlockQuery.data ?? null
  const issuance = issuanceQuery.data ?? null

  const status =
    referendum.status.type === "Ongoing" ? referendum.status : null

  const model = useMemo(() => {
    if (!status || !track || !tally || currentBlock == null || !issuance) return null

    const verdict = computeVerdict({
      status,
      track,
      tally,
      currentBlock,
      supportDenominator: issuance.denominator,
      undecidingTimeout: timeoutQuery.data ?? null,
    })

    // Fraction of the decision period elapsed; before deciding the
    // requirement sits at its day-zero peak, so x = 0.
    const decisionPeriod = track.decisionPeriod
    const since = verdict.decidingSince
    const toX = (block: number) =>
      since != null && decisionPeriod > 0 ? clamp01((block - since) / decisionPeriod) : 0
    const x = toX(currentBlock)
    const meetsX = verdict.meetsCurvesAt != null ? toX(verdict.meetsCurvesAt) : null

    const requiredApproval = verdict.approvalNeededNow ?? evaluateCurve(track.minApproval, 0)
    const requiredSupport = verdict.supportNeededNow ?? evaluateCurve(track.minSupport, 0)
    const deciding = since != null

    const chartTone = (passingNow: boolean, shortAtEnd: boolean): ChartTone => {
      if (!deciding) return "idle"
      if (passingNow) return "pass"
      if (shortAtEnd || verdict.kind === "short" || verdict.kind === "slipping") return "short"
      return verdict.kind === "no-votes" ? "idle" : "course"
    }
    const approvalTone = chartTone(verdict.approval >= requiredApproval, verdict.approvalShort)
    const supportTone = chartTone(verdict.support >= requiredSupport, verdict.supportShort)

    const fmt = (block: number) => blockToDate(block, currentBlock)
    const copy = verdictCopy(
      verdict,
      {
        when: (b) => formatWhen(fmt(b)),
        day: (b) => formatDay(fmt(b)),
        amount: (p) => formatTokenAmount(p, chain, { maxFractionDigits: 0 }),
        pct: fmtPctPlain,
        ofIssuance: issuance.basis === "total" ? "of total issuance" : "of active issuance",
        decisionDeposit: track.decisionDeposit,
        maxDeciding: track.maxDeciding,
      },
      currentBlock,
    )

    return {
      verdict,
      copy,
      x,
      meetsX,
      totalDays: blocksToSeconds(decisionPeriod) / 86_400,
      requiredApproval,
      requiredSupport,
      approvalTone,
      supportTone,
      floorLabel: formatTokenAmount(verdict.supportFloor, chain, { maxFractionDigits: 0 }),
      endDay: verdict.decisionEnd != null ? formatDay(fmt(verdict.decisionEnd)) : null,
      meetsDay: verdict.meetsCurvesAt != null ? formatDay(fmt(verdict.meetsCurvesAt)) : null,
    }
  }, [status, track, tally, currentBlock, issuance, timeoutQuery.data, chain])

  if (!status) {
    return (
      <p className="text-sm text-muted-foreground leading-relaxed">
        Thresholds apply to live referenda. This one has reached a terminal
        state - see the Tally slide for its final figures.
      </p>
    )
  }
  if (!track) {
    return (
      <p className="text-sm text-muted-foreground leading-relaxed">
        Threshold curves are unavailable - the track for this referendum
        couldn&apos;t be resolved.
      </p>
    )
  }
  if (!tally || !model) {
    return (
      <p className="text-sm text-muted-foreground leading-relaxed">
        Waiting on the on-chain tally before thresholds can be evaluated.
      </p>
    )
  }

  const { verdict, copy, x, meetsX, totalDays, requiredApproval, requiredSupport } = model
  const basis = issuanceQuery.data?.basis ?? null

  return (
    <div className="space-y-5">
      <VerdictBadge copy={copy} />

      <DecisionCurveChart
        title="Approval"
        curve={track.minApproval}
        nowX={x}
        current={verdict.approval}
        required={requiredApproval}
        tone={model.approvalTone}
        meetsX={model.approvalTone === "course" ? meetsX : null}
        totalDays={totalDays}
        scale="linear"
        caption={chartCaption({
          tone: model.approvalTone,
          required: requiredApproval,
          current: verdict.approval,
          atEnd: verdict.approvalNeededAtEnd,
          endDay: model.endDay,
          meetsDay: model.meetsDay,
          floorLabel: null,
          basis: null,
          shortAtEnd: verdict.approvalShort,
        })}
      />
      <DecisionCurveChart
        title="Support"
        curve={track.minSupport}
        nowX={x}
        current={verdict.support}
        required={requiredSupport}
        tone={model.supportTone}
        meetsX={model.supportTone === "course" ? meetsX : null}
        totalDays={totalDays}
        scale="sqrt"
        basis={basis}
        caption={chartCaption({
          tone: model.supportTone,
          required: requiredSupport,
          current: verdict.support,
          atEnd: verdict.supportNeededAtEnd,
          endDay: model.endDay,
          meetsDay: model.meetsDay,
          floorLabel: model.floorLabel,
          basis,
          shortAtEnd: verdict.supportShort,
        })}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Verdict chip
// ---------------------------------------------------------------------------

const TONE_STYLES: Record<VerdictTone, { chip: string; icon: typeof CheckCircle2 }> = {
  pass: { chip: "border-green-500/30 bg-green-500/10 text-green-500", icon: CheckCircle2 },
  short: { chip: "border-amber-500/30 bg-amber-500/10 text-amber-500", icon: TriangleAlert },
  course: { chip: "border-purple-border bg-primary/10 text-primary", icon: Clock },
  idle: { chip: "border-border bg-muted/40 text-muted-foreground", icon: PauseCircle },
}

/**
 * The verdict chip. A tap (or click) opens a card that explains it in
 * plain words; the line under the chip carries the one fact that matters
 * most (a date or an amount).
 */
function VerdictBadge({ copy }: { copy: VerdictCopy }) {
  const style = TONE_STYLES[copy.tone]
  const confirming = copy.label === "Confirming"
  const Icon = confirming ? Loader2 : style.icon
  return (
    <Popover>
      {/* Anchored to the full slide width: the card opens under the line below
          the chip, and on a phone it lines up with the charts on both sides. */}
      <PopoverAnchor asChild>
        <div className="w-full flex flex-col items-start gap-1.5">
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                style.chip,
              )}
              aria-label={`${copy.label}: what this means`}
            >
              <Icon className={cn("w-4 h-4", confirming && "animate-spin")} />
              {copy.label}
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </button>
          </PopoverTrigger>
          {copy.sub && <p className="text-xs text-muted-foreground pl-1">{copy.sub}</p>}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-[min(22rem,var(--radix-popper-anchor-width))] max-sm:w-(--radix-popper-anchor-width) rounded-xl p-4 space-y-2 text-sm leading-relaxed"
      >
        <p className="font-semibold text-foreground">{copy.label}</p>
        <p className="text-foreground/90">{copy.body}</p>
        {copy.note && <p className="text-xs text-muted-foreground">{copy.note}</p>}
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Decision-curve chart
// ---------------------------------------------------------------------------

const W = 340
const H = 190
const PAD_L = 30
const PAD_R = 12
const PAD_T = 12
const PAD_B = 20
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

const NICE_MAXES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1]

function DecisionCurveChart({
  title,
  curve,
  nowX,
  current,
  required,
  tone,
  meetsX,
  totalDays,
  scale,
  caption,
}: {
  title: string
  curve: GovernanceCurve
  nowX: number
  current: number | null
  required: number
  tone: ChartTone
  /** Where today's value meets the falling requirement, while on course. */
  meetsX: number | null
  totalDays: number
  scale: "linear" | "sqrt"
  /** For the support chart: which issuance the percentages are of. */
  basis?: SupportBasis | null
  caption: string
}) {
  const [hoverX, setHoverX] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const samples = useMemo(() => sampleCurve(curve, 120), [curve])

  // Axis max: 1 (100%) for the linear approval axis; for the sqrt-scaled
  // support axis, round the tallest plotted value up to a nice ceiling so
  // the tiny support figures aren't crushed into a sliver.
  const axisMax = useMemo(() => {
    if (scale === "linear") return 1
    const raw = Math.max(current ?? 0, ...samples.map((s) => s.y), 0.005)
    return NICE_MAXES.find((m) => m >= raw) ?? 1
  }, [scale, current, samples])

  const yScale = (v: number) => {
    const r = clamp01(v / axisMax)
    return scale === "sqrt" ? Math.sqrt(r) : r
  }
  const sx = (x: number) => PAD_L + clamp01(x) * PLOT_W
  const sy = (v: number) => PAD_T + (1 - yScale(v)) * PLOT_H

  const yTicks = useMemo<number[]>(
    () =>
      scale === "linear"
        ? [1, 0.75, 0.5, 0.25, 0]
        : [axisMax, axisMax * 0.2, axisMax * 0.04, axisMax * 0.01],
    [scale, axisMax],
  )
  const xTicks = useMemo(
    () => [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, day: Math.round(f * totalDays) })),
    [totalDays],
  )

  const linePath = useMemo(
    () =>
      samples
        .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
        .join(" "),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [samples, scale, axisMax],
  )
  // Fail zone: everything under the requirement curve (being here = short).
  const areaPath = `${linePath} L${sx(1).toFixed(2)},${sy(0).toFixed(2)} L${sx(0).toFixed(2)},${sy(0).toFixed(2)} Z`

  const toneText = TONE_TEXT[tone]
  const requiredEnd = samples[samples.length - 1]?.y ?? required

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    setHoverX(clamp01((frac * W - PAD_L) / PLOT_W))
  }

  const hoverRequired = hoverX == null ? null : evaluateCurve(curve, hoverX)
  const hoverDay = hoverX == null ? null : Math.round(hoverX * totalDays)

  return (
    <div className="rounded-xl border border-border bg-surface-1/50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span className={cn("flex items-center gap-1.5 text-base font-bold tabular-nums", toneText.value)}>
          {current == null ? "—" : fmtPctPlain(current)}
          <toneText.Icon className={cn("w-4 h-4", toneText.icon)} />
        </span>
      </div>

      <div className="flex items-center gap-4 mt-1 mb-1.5 text-[10px] text-muted-foreground">
        <LegendSwatch className="bg-primary" label="Required (curve)" />
        <LegendSwatch className="bg-foreground" label="This referendum" />
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto select-none"
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverX(null)}
        >
          {/* horizontal gridlines + y-axis labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={PAD_L}
                y1={sy(v)}
                x2={PAD_L + PLOT_W}
                y2={sy(v)}
                stroke="var(--color-border)"
                strokeWidth={1}
                opacity={0.5}
              />
              <text
                x={PAD_L - 4}
                y={sy(v) + 3}
                className="fill-muted-foreground"
                fontSize={8}
                textAnchor="end"
              >
                {fmtPct(v)}
              </text>
            </g>
          ))}

          {/* fail zone under the requirement curve */}
          <path d={areaPath} className="fill-primary/10" />
          {/* requirement curve */}
          <path
            d={linePath}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {/* direct label on the curve end */}
          <text
            x={sx(1) - 2}
            y={sy(requiredEnd) - 4}
            className="fill-primary"
            fontSize={8}
            textAnchor="end"
          >
            required
          </text>

          {/* actual trajectory - flat at current (v1), start to now, in ink */}
          {current != null && (
            <>
              <line
                x1={sx(0)}
                y1={sy(current)}
                x2={sx(nowX)}
                y2={sy(current)}
                className="stroke-foreground"
                strokeWidth={2}
                strokeLinecap="round"
              />
              {meetsX != null && meetsX > nowX && (
                <>
                  <line
                    x1={sx(nowX)}
                    y1={sy(current)}
                    x2={sx(meetsX)}
                    y2={sy(current)}
                    className="stroke-primary"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={sx(meetsX)}
                    cy={sy(current)}
                    r={3.5}
                    className="fill-card stroke-primary"
                    strokeWidth={1.5}
                  />
                </>
              )}
              <circle cx={sx(nowX)} cy={sy(current)} r={3.5} className={toneText.dot} />
              <text
                x={sx(nowX) + (nowX > 0.8 ? -6 : 6)}
                // Below the dot when it sits at the top, clear of the "now" label.
                y={sy(current) < PAD_T + 14 ? sy(current) + 11 : sy(current) - 5}
                className={cn("font-semibold fill-current", toneText.label)}
                fontSize={8}
                textAnchor={nowX > 0.8 ? "end" : "start"}
              >
                {fmtPctPlain(current)}
              </text>
            </>
          )}

          {/* now marker */}
          <line
            x1={sx(nowX)}
            y1={PAD_T}
            x2={sx(nowX)}
            y2={PAD_T + PLOT_H}
            stroke="var(--color-muted-foreground)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.7}
          />
          <text
            x={clampLabelX(sx(nowX))}
            y={PAD_T - 3}
            className="fill-muted-foreground"
            fontSize={8}
            textAnchor="middle"
          >
            now
          </text>

          {/* hover crosshair */}
          {hoverX != null && (
            <line
              x1={sx(hoverX)}
              y1={PAD_T}
              x2={sx(hoverX)}
              y2={PAD_T + PLOT_H}
              stroke="var(--color-foreground)"
              strokeWidth={1}
              opacity={0.35}
            />
          )}

          {/* x-axis day labels */}
          {xTicks.map((t, i) => (
            <text
              key={t.f}
              x={sx(t.f)}
              y={H - 6}
              className="fill-muted-foreground"
              fontSize={8}
              textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            >
              d{t.day}
            </text>
          ))}
        </svg>

        {hoverX != null && hoverRequired != null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-border bg-popover px-2 py-1 text-[10px] leading-tight shadow-lg"
            style={tooltipStyle(hoverX)}
          >
            <div className="text-muted-foreground">Day {hoverDay}</div>
            <div className="text-primary tabular-nums">needs {fmtPct(hoverRequired)}</div>
            {current != null && (
              <div className={cn("tabular-nums", toneText.label)}>actual {fmtPct(current)}</div>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed mt-2">
        {caption}
      </p>
    </div>
  )
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("w-3 h-[3px] rounded-full", className)} />
      {label}
    </span>
  )
}

const TONE_TEXT: Record<
  ChartTone,
  { value: string; icon: string; label: string; dot: string; Icon: typeof CheckCircle2 }
> = {
  pass: { value: "text-green-500", icon: "", label: "text-green-500", dot: "fill-green-500", Icon: CheckCircle2 },
  short: { value: "text-amber-500", icon: "", label: "text-amber-500", dot: "fill-amber-500", Icon: TriangleAlert },
  course: { value: "text-foreground", icon: "text-primary", label: "text-foreground", dot: "fill-primary", Icon: Clock },
  idle: { value: "text-foreground", icon: "text-muted-foreground", label: "text-foreground", dot: "fill-muted-foreground", Icon: PauseCircle },
}

function chartCaption({
  tone,
  required,
  current,
  atEnd,
  endDay,
  meetsDay,
  floorLabel,
  basis,
  shortAtEnd,
}: {
  tone: ChartTone
  /** Short of the end minimum, not just of today's requirement. */
  shortAtEnd: boolean
  required: number
  current: number
  atEnd: number
  endDay: string | null
  meetsDay: string | null
  /** Support only: the end minimum in tokens. */
  floorLabel: string | null
  basis: SupportBasis | null
}): string {
  const of = basis ? ` of ${basis} issuance` : ""
  const minimum = `${fmtPctPlain(atEnd)}${of}${floorLabel ? ` (${floorLabel})` : ""}`
  switch (tone) {
    case "pass":
      return `Meets it. Needs ${fmtPctPlain(required)}${of} today; currently ${fmtPctPlain(current)}.`
    case "course":
      return `Needs ${fmtPctPlain(required)}${of} today; currently ${fmtPctPlain(current)}. The requirement drops to that${meetsDay ? ` around ${meetsDay}` : ""}. Minimum at the end: ${minimum}.`
    case "short":
      if (!shortAtEnd) return `Below today's requirement of ${fmtPctPlain(required)}${of}; currently ${fmtPctPlain(current)}.`
      return `Below the minimum of ${minimum} at the end of the decision period${endDay ? ` (${endDay})` : ""}; currently ${fmtPctPlain(current)}.`
    case "idle":
      return `Counts once the decision period runs. Needs ${fmtPctPlain(required)}${of} at the start, falling to ${minimum}.`
  }
}

/** "Nov 18, 22:20 UTC". */
function formatWhen(d: Date): string {
  return `${formatDay(d)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`
}

/** "Nov 18". */
function formatDay(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Percent for prose: up to three significant decimals, no trailing zeros. */
function fmtPctPlain(v: number): string {
  const p = v * 100
  if (p >= 10) return `${Number(p.toFixed(1))}%`
  if (p >= 1) return `${Number(p.toFixed(1))}%`
  return `${Number(p.toPrecision(2))}%`
}

// x position (viewBox units) → tooltip left/right anchoring in %.
function tooltipStyle(xf: number): React.CSSProperties {
  const leftPct = ((PAD_L + xf * PLOT_W) / W) * 100
  if (leftPct > 60) return { right: `${100 - leftPct}%` }
  return { left: `${leftPct}%` }
}

function clampLabelX(x: number): number {
  return Math.max(PAD_L + 10, Math.min(W - PAD_R - 10, x))
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function fmtPct(v: number): string {
  const p = v * 100
  if (p === 0) return "0%"
  // Support runs in hundredths of a percent - one decimal place would
  // round e.g. 0.02% down to a misleading "0.0%".
  if (p < 0.005) return "<0.01%"
  if (p < 0.1) return `${p.toFixed(2)}%`
  if (p < 10) return `${p.toFixed(1)}%`
  return `${p.toFixed(0)}%`
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

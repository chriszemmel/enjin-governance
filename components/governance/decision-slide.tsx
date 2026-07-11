"use client"

import { useMemo, useRef, useState } from "react"
import { CheckCircle2, TriangleAlert, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChainConfig } from "@/lib/chain/chains"
import { blocksToSeconds } from "@/lib/chain/format"
import { evaluateCurve, sampleCurve } from "@/lib/governance/curves"
import type {
  GovernanceCurve,
  Referendum,
  Tally,
  Track,
} from "@/lib/governance/types"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import { useTotalIssuance } from "@/lib/query/hooks/use-total-issuance"

interface DecisionSlideProps {
  referendum: Referendum
  track: Track | null
  tally: Tally | null
  chain: ChainConfig
}

type Tone = "pass" | "short" | "confirm"

/**
 * "Decision" slide: is this referendum meeting its two thresholds right
 * now, and how do the decaying requirements compare to where it stands?
 *
 *   - Approval = ayes / (ayes + nays), conviction-weighted (from the tally).
 *   - Support  = tally.support / totalIssuance.
 *
 * Both are checked against the track's decaying requirement curves at
 * today's point in the decision period. v1 renders the actual trajectory
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
  const issuanceQuery = useTotalIssuance(chain)
  const currentBlock = currentBlockQuery.data ?? null
  const totalIssuance = issuanceQuery.data ?? null

  const status =
    referendum.status.type === "Ongoing" ? referendum.status : null

  const model = useMemo(() => {
    if (!status || !track || !tally) return null

    const decisionPeriod = track.decisionPeriod
    const decideStart = status.deciding?.since ?? null
    const confirming = status.deciding?.confirming != null

    // Fraction of the decision period elapsed. Before deciding opens (or
    // before we know the chain head) the requirement sits at its day-zero
    // peak, so x = 0.
    const x =
      decideStart != null && currentBlock != null && decisionPeriod > 0
        ? clamp01((currentBlock - decideStart) / decisionPeriod)
        : 0

    const totalVotes = tally.ayes + tally.nays
    const approvalCurrent = totalVotes > 0n ? ratio(tally.ayes, totalVotes) : 0
    const supportCurrent =
      totalIssuance && totalIssuance > 0n
        ? ratio(tally.support, totalIssuance)
        : null

    const requiredApproval = evaluateCurve(track.minApproval, x)
    const requiredSupport = evaluateCurve(track.minSupport, x)

    const passingApproval = approvalCurrent >= requiredApproval
    const passingSupport =
      supportCurrent != null && supportCurrent >= requiredSupport

    const verdict: { tone: Tone; label: string } = confirming
      ? { tone: "confirm", label: "Confirming" }
      : !passingApproval
        ? { tone: "short", label: "Short on approval" }
        : !passingSupport
          ? { tone: "short", label: "Short on support" }
          : { tone: "pass", label: "On track" }

    const totalDays = blocksToSeconds(decisionPeriod) / 86_400

    return {
      x,
      totalDays,
      approvalCurrent,
      requiredApproval,
      passingApproval,
      supportCurrent,
      requiredSupport,
      passingSupport,
      verdict,
    }
  }, [status, track, tally, currentBlock, totalIssuance])

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

  const {
    x,
    totalDays,
    approvalCurrent,
    requiredApproval,
    passingApproval,
    supportCurrent,
    requiredSupport,
    passingSupport,
    verdict,
  } = model

  return (
    <div className="space-y-5">
      <VerdictChip tone={verdict.tone} label={verdict.label} />

      <DecisionCurveChart
        title="Approval"
        curve={track.minApproval}
        nowX={x}
        current={approvalCurrent}
        required={requiredApproval}
        passing={passingApproval}
        totalDays={totalDays}
        scale="linear"
      />
      <DecisionCurveChart
        title="Support"
        curve={track.minSupport}
        nowX={x}
        current={supportCurrent}
        required={requiredSupport}
        passing={passingSupport}
        totalDays={totalDays}
        scale="sqrt"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Verdict chip
// ---------------------------------------------------------------------------

const TONE_STYLES: Record<
  Tone,
  { chip: string; icon: typeof CheckCircle2; spin?: boolean }
> = {
  pass: {
    chip: "border-green-500/30 bg-green-500/10 text-green-500",
    icon: CheckCircle2,
  },
  short: {
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    icon: TriangleAlert,
  },
  confirm: {
    chip: "border-purple-border bg-primary/10 text-primary",
    icon: Loader2,
    spin: true,
  },
}

function VerdictChip({ tone, label }: { tone: Tone; label: string }) {
  const style = TONE_STYLES[tone]
  const Icon = style.icon
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-semibold",
        style.chip,
      )}
    >
      <Icon className={cn("w-4 h-4", style.spin && "animate-spin")} />
      {label}
    </span>
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
  passing,
  totalDays,
  scale,
}: {
  title: string
  curve: GovernanceCurve
  nowX: number
  current: number | null
  required: number
  passing: boolean
  totalDays: number
  scale: "linear" | "sqrt"
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

  const dotColor = passing ? "#22c55e" : "#f59e0b"
  const toneClass = passing ? "text-green-500" : "text-amber-500"
  const requiredEnd = samples[samples.length - 1]?.y ?? required

  // Day at which the decaying requirement first meets the current value
  // (only meaningful while short - "hold and it passes on ~day N").
  const crossDay = useMemo(() => {
    if (current == null || passing) return null
    const hit = samples.find((p) => p.y <= current)
    if (!hit || hit.x <= nowX) return null
    return Math.round(hit.x * totalDays)
  }, [samples, current, passing, nowX, totalDays])

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    setHoverX(clamp01((frac * W - PAD_L) / PLOT_W))
  }

  const hoverRequired = hoverX == null ? null : evaluateCurve(curve, hoverX)
  const hoverDay = hoverX == null ? null : Math.round(hoverX * totalDays)
  const caption = buildCaption({ passing, required, current, crossDay, scale })

  return (
    <div className="rounded-xl border border-border bg-surface-1/50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span
          className={cn(
            "flex items-center gap-1.5 text-base font-bold tabular-nums",
            passing ? "text-green-500" : "text-amber-500",
          )}
        >
          {current == null ? "—" : fmtPct(current)}
          {passing ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <TriangleAlert className="w-4 h-4" />
          )}
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
              <circle cx={sx(nowX)} cy={sy(current)} r={3.5} fill={dotColor} />
              <text
                x={sx(nowX) + (nowX > 0.8 ? -6 : 6)}
                y={sy(current) - 5}
                className={cn("font-semibold", toneClass, "fill-current")}
                fontSize={8}
                textAnchor={nowX > 0.8 ? "end" : "start"}
              >
                {fmtPct(current)}
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
              <div className={cn("tabular-nums", toneClass)}>actual {fmtPct(current)}</div>
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

function buildCaption({
  passing,
  required,
  current,
  crossDay,
  scale,
}: {
  passing: boolean
  required: number
  current: number | null
  crossDay: number | null
  scale: "linear" | "sqrt"
}): string {
  const ofIssuance = scale === "sqrt" ? " of total issuance" : ""
  if (current == null) return `Requirement today: ${fmtPct(required)}${ofIssuance}.`
  if (passing) {
    return `On the curve. Needs ${fmtPct(required)}${ofIssuance} today; currently ${fmtPct(current)}.`
  }
  const base = `Below the curve. Needs ${fmtPct(required)}${ofIssuance} today; currently ${fmtPct(current)}.`
  if (crossDay != null) {
    return `${base} Holds at this level and the decaying requirement meets it around day ${crossDay}.`
  }
  return base
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

/** Precise bigint ratio → float in [0, ~1]. */
function ratio(num: bigint, den: bigint): number {
  if (den <= 0n) return 0
  return Number((num * 1_000_000_000n) / den) / 1_000_000_000
}

function fmtPct(v: number): string {
  const p = v * 100
  if (p === 0) return "0%"
  if (p < 1) return `${p.toFixed(1)}%`
  if (p < 10) return `${p.toFixed(1)}%`
  return `${p.toFixed(0)}%`
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

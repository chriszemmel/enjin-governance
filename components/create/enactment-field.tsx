"use client"

import { cn } from "@/lib/utils"
import type { EnactmentChoice } from "@/lib/governance/enactment"

/**
 * Enactment-moment picker (gap #2). Default "standard" enacts as soon as
 * possible after passing; advanced modes let a proposer delay by N blocks or
 * target a fixed block height - for coordinated upgrades or time-locked spends.
 */
export function EnactmentField({
  value,
  error,
  minEnactment,
  disabled,
  onChange,
}: {
  value: EnactmentChoice
  error: string | null
  minEnactment: number | null
  disabled: boolean
  onChange: (v: EnactmentChoice) => void
}) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:text-foreground transition-colors text-sm font-medium text-foreground">
        Enactment timing
        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
          {value.mode === "standard"
            ? "as soon as it passes"
            : value.mode === "afterDelay"
              ? `+${value.blocks} blocks`
              : `at #${value.block}`}
        </span>
      </summary>

      <div className="mt-3 space-y-3 pl-1">
        <div className="flex flex-wrap gap-2">
          <ModeButton
            active={value.mode === "standard"}
            disabled={disabled}
            onClick={() => onChange({ mode: "standard" })}
          >
            As soon as possible
          </ModeButton>
          <ModeButton
            active={value.mode === "afterDelay"}
            disabled={disabled}
            onClick={() => onChange({ mode: "afterDelay", blocks: 0 })}
          >
            Delay (blocks)
          </ModeButton>
          <ModeButton
            active={value.mode === "atBlock"}
            disabled={disabled}
            onClick={() => onChange({ mode: "atBlock", block: 0 })}
          >
            At block height
          </ModeButton>
        </div>

        {value.mode === "afterDelay" && (
          <NumberInput
            label="Blocks after passing"
            value={value.blocks}
            disabled={disabled}
            onChange={(blocks) => onChange({ mode: "afterDelay", blocks })}
          />
        )}
        {value.mode === "atBlock" && (
          <NumberInput
            label="Target block height"
            value={value.block}
            disabled={disabled}
            onChange={(block) => onChange({ mode: "atBlock", block })}
          />
        )}

        {error ? (
          <p className="text-[11px] text-destructive">{error}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The runtime enacts no sooner than this track&apos;s minimum enactment
            period{minEnactment != null ? ` (${minEnactment} blocks)` : ""} after
            the referendum passes.
          </p>
        )}
      </div>
    </details>
  )
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50",
        active
          ? "bg-primary/10 border-purple-border text-foreground"
          : "bg-surface-1 border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function NumberInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(e) => onChange(Math.floor(Number(e.target.value)))}
        className="w-40 px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-foreground font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
      />
    </label>
  )
}

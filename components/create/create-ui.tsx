"use client"

import { Check, Copy, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export type WizardStep = "create" | "review" | "submit"

export type DraftResponse = {
  ok: true
  id: string
  json_url: string
  json_sha256: string
  json_size_bytes: number
  remark_payload: string
  proposal: unknown
}

const STEPS: { id: WizardStep; label: string }[] = [
  { id: "create", label: "Create" },
  { id: "review", label: "Review" },
  { id: "submit", label: "Submit" },
]

export function StepBar({ current }: { current: WizardStep }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current)
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div
          key={s.id}
          className={cn(
            "flex items-center",
            i < STEPS.length - 1 && "flex-1",
          )}
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div
              className={cn(
                "w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-[11px] sm:text-xs font-semibold border transition-all duration-300 flex-shrink-0",
                i < currentIdx
                  ? "bg-primary border-primary text-primary-foreground"
                  : i === currentIdx
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground",
              )}
            >
              {i < currentIdx ? <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                "text-xs sm:text-sm font-medium",
                i === currentIdx ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                "flex-1 h-px mx-2 sm:mx-3 transition-colors duration-300 min-w-[8px]",
                i < currentIdx ? "bg-primary/50" : "bg-border",
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 pb-3 border-b border-border last:border-0 last:pb-0">
      <span className="text-xs text-muted-foreground w-24 flex-shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-foreground leading-relaxed flex-1 min-w-0">
        {children}
      </span>
    </div>
  )
}

export function ArtefactRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-8 h-8 rounded-md bg-surface-2 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  )
}

export function CopyableMono({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono">
      <span className="text-muted-foreground">{label}:</span>
      <code className="text-foreground break-all">{value}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value)
          toast.success("Copied")
        }}
        className="text-muted-foreground hover:text-foreground"
        title="Copy"
      >
        <Copy className="w-3 h-3" />
      </button>
    </div>
  )
}

export function TxHashLine({
  txHash,
  url,
}: {
  txHash: string
  url: string | null
}) {
  const short = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground mt-0.5 min-w-0">
      <span className="flex-shrink-0">tx:</span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:text-purple-dim truncate"
          title="Open on Subscan"
        >
          <span className="truncate">{short}</span>
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
      ) : (
        <span className="text-foreground truncate">{short}</span>
      )}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(txHash)
          toast.success("Copied")
        }}
        className="text-muted-foreground hover:text-foreground flex-shrink-0"
        title="Copy transaction hash"
      >
        <Copy className="w-3 h-3" />
      </button>
    </div>
  )
}

export function formatPlanckShort(amount: bigint, decimals: number, ticker: string): string {
  const whole = amount / 10n ** BigInt(decimals)
  const frac = amount % 10n ** BigInt(decimals)
  if (frac === 0n) return `${whole.toString()} ${ticker}`
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "")
  return `${whole.toString()}.${fracStr.slice(0, 4)} ${ticker}`
}

interface FieldProps {
  label: string
  required?: boolean
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  multiline?: boolean
  rows?: number
  maxLength?: number
  mono?: boolean
  disabled?: boolean
}

export function Field({
  label,
  required,
  value,
  onChange,
  placeholder,
  hint,
  multiline,
  rows = 3,
  maxLength,
  mono,
  disabled,
}: FieldProps) {
  const inputClass = cn(
    "w-full px-4 py-3 rounded-xl bg-surface-1 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all disabled:opacity-50",
    mono && "font-mono",
    multiline && "resize-y",
  )
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          className={inputClass}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          className={inputClass}
        />
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

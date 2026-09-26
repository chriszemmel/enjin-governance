"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bot, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import {
  costUsd,
  SCAN_MODEL_IDS,
  SCAN_MODELS,
  TYPICAL_TOKENS,
  type ScanKind,
  type ScanSettings,
} from "@/lib/moderation/scan-settings"
import { useSaveScanSettings, useScanSettings } from "@/lib/query/hooks/use-moderation"
import { cn } from "@/lib/utils"
import { formatError } from "@/lib/utils/format-error"

const KIND_LABELS: Record<ScanKind, { label: string; hint: string }> = {
  images: { label: "Images", hint: "before they are stored" },
  pdfs: { label: "PDFs", hint: "before they are stored" },
  proposals: { label: "Proposal text", hint: "flag only, after saving" },
  comments: { label: "Comments", hint: "flag only, after posting" },
}

const KIND_SHORT: Record<string, string> = {
  images: "image",
  pdfs: "PDF",
  proposals: "proposal",
  comments: "comment",
}

function usd(n: number): string {
  if (n === 0) return "$0"
  if (n < 0.001) return `$${n.toFixed(4)}`
  if (n < 0.1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function perCheck(model: string, kind: ScanKind): number {
  const t = TYPICAL_TOKENS[kind]
  return costUsd(model, t.input, t.output)
}

export function ScanSettingsPanel() {
  const query = useScanSettings(true)
  const save = useSaveScanSettings()
  const [draft, setDraft] = useState<ScanSettings | null>(null)

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.settings)
  }, [query.data, draft])

  if (query.isPending || (!draft && !query.isError)) {
    return <p className="text-sm text-muted-foreground">Loading the settings…</p>
  }
  if (query.isError || !draft) {
    return (
      <p className="text-sm text-destructive">
        Could not load the settings: {formatError(query.error)}
      </p>
    )
  }

  const data = query.data
  const set = <K extends keyof ScanSettings>(key: K, value: ScanSettings[K]) =>
    setDraft({ ...draft, [key]: value })
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings)
  const monthTotal = (data.month ?? []).reduce((sum, r) => sum + r.cost_usd, 0)
  const monthChecks = (data.month ?? []).reduce((sum, r) => sum + r.checks, 0)
  const worstDay = draft.dailyLimit * perCheck(draft.model, "images")

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
      <div className="rounded-2xl bg-card border border-border p-5 space-y-6">
        {/* On / off */}
        <div className="flex items-start gap-3">
          <Bot className="w-5 h-5 mt-0.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <label htmlFor="scan-enabled" className="text-sm font-medium text-foreground">
              Check content automatically
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Claude sorts each item into allow, review or block. Anything unclear goes to the queue
              - a person decides. Text is never hidden automatically.
            </p>
            {!data.api_key_configured && (
              <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                No API key on the server. Add <span className="font-mono">ANTHROPIC_API_KEY</span>{" "}
                to the environment; until then nothing is checked.
              </p>
            )}
          </div>
          <Switch
            id="scan-enabled"
            checked={draft.enabled}
            onCheckedChange={(v) => set("enabled", v)}
          />
        </div>

        <fieldset className={cn("space-y-6", !draft.enabled && "opacity-60")}>
          {/* Model */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">Model</h3>
            <div role="radiogroup" aria-label="Model" className="space-y-2">
              {SCAN_MODEL_IDS.map((id) => {
                const m = SCAN_MODELS[id]
                const active = draft.model === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => set("model", id)}
                    className={cn(
                      "w-full text-left rounded-xl border px-3.5 py-3 transition-colors",
                      active
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:border-primary/30",
                    )}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={cn(
                          "inline-block w-3 h-3 rounded-full border shrink-0 translate-y-0.5",
                          active ? "border-primary bg-primary" : "border-muted-foreground/40",
                        )}
                      />
                      <span className="text-sm font-medium text-foreground">{m.label}</span>
                      {id === "claude-haiku-4-5" && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          recommended
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        ${m.inputPerMTok} in / ${m.outputPerMTok} out per million tokens
                      </span>
                    </div>
                    <p className="mt-1 pl-5 text-xs text-muted-foreground">{m.note}</p>
                    <p className="mt-1 pl-5 text-[11px] text-muted-foreground">
                      Per check about{" "}
                      {(["images", "pdfs", "proposals", "comments"] as const)
                        .map((k) => `${usd(perCheck(id, k))} ${KIND_SHORT[k]}`)
                        .join(" · ")}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* What */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">What to check</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(Object.keys(KIND_LABELS) as ScanKind[]).map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 cursor-pointer"
                >
                  <Checkbox checked={draft[k]} onCheckedChange={(v) => set(k, v === true)} />
                  <span className="text-sm text-foreground">{KIND_LABELS[k].label}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {KIND_LABELS[k].hint}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Clear violations */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              Upload with a clear violation
              <span className="font-normal text-muted-foreground">
                {" "}
                - e.g. a readable recovery phrase
              </span>
            </h3>
            <div
              role="radiogroup"
              aria-label="Clear violations"
              className="grid gap-2 sm:grid-cols-2"
            >
              {(
                [
                  ["reject", "Reject the upload", "Never stored; the uploader sees why."],
                  ["hold", "Hold for a moderator", "Stored but not shown until someone decides."],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={draft.onClearViolation === value}
                  onClick={() => set("onClearViolation", value)}
                  className={cn(
                    "text-left rounded-xl border px-3 py-2.5",
                    draft.onClearViolation === value
                      ? "border-primary/60 bg-primary/5"
                      : "border-border hover:border-primary/30",
                  )}
                >
                  <span className="block text-sm text-foreground">{label}</span>
                  <span className="block text-[11px] text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Limit */}
          <div className="space-y-2">
            <label htmlFor="scan-limit" className="block text-sm font-medium text-foreground">
              Daily limit
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="scan-limit"
                type="number"
                min={0}
                max={100000}
                value={draft.dailyLimit}
                onChange={(e) =>
                  set(
                    "dailyLimit",
                    Math.max(0, Math.min(100_000, Math.floor(Number(e.target.value) || 0))),
                  )
                }
                className="w-28 rounded-xl border border-border bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
              <span className="text-xs text-muted-foreground">
                checks a day (UTC); past it, uploads wait for a moderator and text isn&apos;t
                checked until the next day. Text uses at most half of the limit. {draft.dailyLimit}{" "}
                image checks cost about {usd(worstDay)}.
              </span>
            </div>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(draft, {
                onSuccess: () => toast.success("Settings saved"),
                onError: (e) => toast.error("Could not save", { description: formatError(e) }),
              })
            }
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => setDraft(data.settings)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Discard changes
            </button>
          )}
          <span className="text-[11px] text-muted-foreground sm:ml-auto">
            Changes apply within a minute.
          </span>
        </div>
      </div>

      {/* Usage */}
      <div className="rounded-2xl bg-card border border-border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">This month</h3>
          <p className="text-2xl font-semibold text-foreground mt-1">{usd(monthTotal)}</p>
          <p className="text-xs text-muted-foreground">
            {monthChecks} check{monthChecks === 1 ? "" : "s"}
            {data.checks_today != null && ` · today ${data.checks_today} of ${draft.dailyLimit}`}
          </p>
        </div>
        {data.month == null ? (
          <p className="text-xs text-muted-foreground">
            Usage isn&apos;t recorded yet - apply migration{" "}
            <span className="font-mono">012_moderation_settings.sql</span>.
          </p>
        ) : data.month.length === 0 ? (
          <p className="text-xs text-muted-foreground">No checks this month.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-normal">Model</th>
                <th className="py-1 font-normal">Kind</th>
                <th className="py-1 font-normal text-right">Checks</th>
                <th className="py-1 font-normal text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.month.map((r) => (
                <tr key={`${r.model}:${r.kind}`}>
                  <td className="py-1.5 text-foreground">
                    {SCAN_MODELS[r.model as keyof typeof SCAN_MODELS]?.label ?? r.model}
                  </td>
                  <td className="py-1.5 text-muted-foreground">{KIND_SHORT[r.kind] ?? r.kind}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.checks}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Costs are estimated from the tokens the API reports, at list prices. Checked content is
          sent to Anthropic only while checks are on (see the{" "}
          <Link href="/privacy" className="text-primary">
            privacy policy
          </Link>
          ); it is not used for training.
        </p>
      </div>
    </div>
  )
}

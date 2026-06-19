"use client"

import { useState } from "react"
import { CheckCircle2, ShieldAlert } from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"
import {
  DISCLOSURE_CATEGORIES,
  HONEYPOT_FIELD,
  SEVERITIES,
  type Severity,
} from "@/lib/security/disclosure"

type State = "idle" | "submitting" | "done" | "error"

export default function SecurityPage() {
  const [severity, setSeverity] = useState<Severity>("medium")
  const [category, setCategory] = useState<string>(DISCLOSURE_CATEGORIES[0])
  const [summary, setSummary] = useState("")
  const [details, setDetails] = useState("")
  const [contact, setContact] = useState("")
  // Honeypot: stays empty for real users (the field is hidden). A bot that
  // auto-fills every input will populate it, and the server drops it.
  const [website, setWebsite] = useState("")
  const [state, setState] = useState<State>("idle")
  const [error, setError] = useState<string | null>(null)

  const valid = summary.trim().length >= 8 && details.trim().length >= 20

  const submit = async () => {
    if (!valid || state === "submitting") return
    setState("submitting")
    setError(null)
    try {
      const res = await fetch("/api/security-disclosures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          severity,
          category,
          summary: summary.trim(),
          details: details.trim(),
          contact: contact.trim() || null,
          [HONEYPOT_FIELD]: website,
        }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Request failed (${res.status})`)
        setState("error")
        return
      }
      setState("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error")
      setState("error")
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start gap-3 mb-6">
            <div className="w-11 h-11 rounded-xl bg-primary/10 border border-purple-border flex items-center justify-center flex-shrink-0">
              <ShieldAlert className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Report a security issue
              </h1>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                Found a vulnerability in this dApp or the governance flows? Report
                it privately here. Please don&apos;t open a public issue or share
                exploit details publicly until it&apos;s resolved.
              </p>
            </div>
          </div>

          {state === "done" ? (
            <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/30 p-6 flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Report received - thank you.
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  The team has been notified. If you left a contact, we&apos;ll
                  follow up on coordinated disclosure.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-card border border-border p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Severity</label>
                <div className="flex flex-wrap gap-2">
                  {SEVERITIES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeverity(s)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border capitalize transition-colors",
                        severity === s
                          ? "bg-primary/10 border-purple-border text-foreground"
                          : "bg-surface-1 border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Area</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-foreground focus:outline-none focus:border-primary/50"
                >
                  {DISCLOSURE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <Field
                label="Summary"
                required
                value={summary}
                onChange={setSummary}
                placeholder="One line - e.g. 'XSS in proposal comments'"
                maxLength={200}
                hint={`${summary.trim().length}/200 · min 8`}
              />

              <Field
                label="Details"
                required
                multiline
                value={details}
                onChange={setDetails}
                placeholder="Impact, steps to reproduce, affected component. The more concrete, the faster we can fix it."
                maxLength={10_000}
                hint={`${details.trim().length} chars · min 20`}
              />

              <Field
                label="Contact (optional)"
                value={contact}
                onChange={setContact}
                placeholder="Email or handle for coordinated follow-up"
                maxLength={200}
              />

              {/*
                Honeypot. Visually hidden, removed from the tab order, and
                aria-hidden so no real user (or screen reader) ever reaches it.
                A bot that fills every input trips it and the server discards
                the submission. Not `display:none` - some bots skip those.
              */}
              <div
                aria-hidden="true"
                className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden"
              >
                <label htmlFor={HONEYPOT_FIELD}>Website</label>
                <input
                  id={HONEYPOT_FIELD}
                  name={HONEYPOT_FIELD}
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              {state === "error" && error && (
                <p className="text-[11px] text-destructive">{error}</p>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={!valid || state === "submitting"}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {state === "submitting" ? "Sending…" : "Send report"}
              </button>
              <p className="text-[11px] text-muted-foreground">
                Submitted privately to the maintainers. No wallet or account
                required.
              </p>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  required,
  multiline,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  required?: boolean
  multiline?: boolean
  maxLength?: number
}) {
  const klass =
    "w-full px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
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
          rows={7}
          maxLength={maxLength}
          className={cn(klass, "resize-y")}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className={klass}
        />
      )}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

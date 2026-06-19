"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, Lock } from "lucide-react"
import { EnjinLogo } from "@/components/layout/enjin-logo"
import { sanitizeNext } from "@/lib/auth/site-password"

export default function UnlockPage() {
  return (
    <Suspense fallback={<UnlockShell />}>
      <UnlockInner />
    </Suspense>
  )
}

function UnlockInner() {
  const router = useRouter()
  const params = useSearchParams()
  const next = sanitizeNext(params.get("next"))

  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean
        next?: string
        error?: string
      }
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Incorrect password")
        setSubmitting(false)
        inputRef.current?.select()
        return
      }
      router.replace(data.next ?? next)
      router.refresh()
    } catch {
      setError("Could not reach the server. Try again.")
      setSubmitting(false)
    }
  }

  return (
    <UnlockShell>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <label
            htmlFor="site-password"
            className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Access password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              id="site-password"
              ref={inputRef}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError(null)
              }}
              disabled={submitting}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "site-password-error" : undefined}
              className="w-full h-11 pl-10 pr-3 rounded-xl bg-surface-1 border border-purple-border/60 text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              placeholder="Enter password"
            />
          </div>
          {error && (
            <p
              id="site-password-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!password || submitting}
          className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors glow-purple-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Unlocking…
            </>
          ) : (
            "Unlock"
          )}
        </button>
      </form>
    </UnlockShell>
  )
}

function UnlockShell({ children }: { children?: React.ReactNode }) {
  return (
    <main className="relative min-h-screen flex items-center justify-center px-4 py-16 bg-background overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-primary/10 blur-[140px]" />
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 w-[360px] h-[260px] rounded-full bg-primary/15 blur-[100px]" />

      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-purple-border/60 bg-card/80 backdrop-blur-md shadow-2xl shadow-black/30 p-6 sm:p-8">
          <div className="flex items-center justify-center gap-3 mb-6">
            <EnjinLogo className="h-6 w-auto" />
            <span
              aria-hidden
              className="h-6 w-px self-center bg-gradient-to-b from-transparent via-foreground/30 to-transparent"
            />
            <span className="text-sm font-medium text-muted-foreground">
              Governance
            </span>
          </div>

          <p className="text-sm text-muted-foreground text-center mb-6">
            This preview is password protected. Enter the access password to
            continue.
          </p>

          {children ?? <div className="h-11" />}
        </div>
      </div>
    </main>
  )
}

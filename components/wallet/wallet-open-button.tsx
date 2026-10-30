"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/** Below this, a wait shows no spinner, so a fast relay doesn't flicker. */
const SPINNER_AFTER_MS = 200
/** Then a short line under the button says it is still on its way. */
const SLOW_AFTER_MS = 5_000
/** And after this, that it may not get through. */
const STUCK_AFTER_MS = 15_000

type Phase = "fresh" | "waiting" | "slow" | "stuck"

/**
 * "Open in <wallet>": a deep link into the wallet app, held back until the
 * relay has the request (`ready`). Tapped earlier, iOS sends the page to the
 * background mid-send and the wallet opens to nothing.
 *
 * While it waits the label stays, the fill dims and a spinner takes the
 * icon's place (after a moment, so fast cases don't flash). A fixed-height
 * line below says when it takes long and, if it seems stuck, to close and
 * try again (closing the dialog starts over); nothing around it moves. Taps
 * while waiting do nothing: the deep link has to come from a tap on the
 * ready link.
 */
export function WalletOpenButton({
  href,
  ready,
  walletName,
  onTap,
}: {
  href: string
  ready: boolean
  walletName: string
  /** Called on each tap of the ready link (the link itself opens the wallet). */
  onTap?: () => void
}) {
  const [phase, setPhase] = useState<Phase>("fresh")

  useEffect(() => {
    if (ready) return
    setPhase("fresh")
    const timers = [
      setTimeout(() => setPhase("waiting"), SPINNER_AFTER_MS),
      setTimeout(() => setPhase("slow"), SLOW_AFTER_MS),
      setTimeout(() => setPhase("stuck"), STUCK_AFTER_MS),
    ]
    return () => timers.forEach(clearTimeout)
  }, [ready])

  const label = `Open in ${walletName}`
  const base =
    "w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-primary-foreground transition-colors duration-200 motion-reduce:transition-none"

  return (
    <div>
      {ready ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onTap}
          className={cn(base, "bg-primary hover:bg-purple-dim glow-purple-sm")}
        >
          <ExternalLink className="w-4 h-4" />
          {label}
        </a>
      ) : (
        <button
          type="button"
          aria-disabled="true"
          aria-busy="true"
          onClick={(e) => e.preventDefault()}
          className={cn(
            base,
            "cursor-default",
            // Only the fill dims: the label keeps its contrast.
            phase === "fresh" ? "bg-primary" : "bg-primary/45",
          )}
        >
          {phase === "fresh" ? (
            <ExternalLink className="w-4 h-4" />
          ) : (
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
          )}
          {label}
        </button>
      )}

      <p className="h-5 mt-1.5 flex items-center justify-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap">
        {!ready && phase === "slow" && "Still connecting…"}
        {!ready && phase === "stuck" && "Not through yet. Close and try again."}
      </p>

      <span className="sr-only" aria-live="polite">
        {ready ? `Ready. ${label}.` : phase !== "fresh" ? "Preparing the request" : ""}
      </span>
    </div>
  )
}

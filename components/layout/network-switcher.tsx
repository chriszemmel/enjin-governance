"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, ChevronDown, FlaskConical, Network } from "lucide-react"
import { cn } from "@/lib/utils"
import { CHAINS, type ChainId } from "@/lib/chain/chains"
import { useActiveChain, useSetActiveChain } from "@/lib/chain/use-chain"
import { useWallet, useWalletActions } from "@/lib/wallet/use-wallet"
import { useSignOut } from "@/lib/query/hooks/use-session"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const SWITCHABLE = ["enjin-relay", "canary-relay"] as const

interface NetworkSwitcherProps {
  className?: string
}

export function NetworkSwitcher({ className }: NetworkSwitcherProps) {
  const active = useActiveChain()
  const setChainId = useSetActiveChain()
  const wallet = useWallet()
  const walletActions = useWalletActions()
  const signOut = useSignOut()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<ChainId | null>(null)
  const [confirming, setConfirming] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const isConnected = wallet.status === "connected"

  const requestSwitch = (id: ChainId) => {
    setOpen(false)
    if (id === active.id) return
    // Wallet connected? Show the confirm modal so the user understands
    // they'll lose the session. Otherwise switch silently.
    if (isConnected) {
      setPending(id)
    } else {
      setChainId(id)
    }
  }

  const confirmSwitch = async () => {
    if (!pending) return
    setConfirming(true)
    try {
      // Drop the SIWE session first - it was minted against the current
      // network's address and the new chain may use a different prefix.
      if (wallet.status === "connected") {
        void signOut.mutateAsync().catch(() => {})
        await walletActions.disconnect()
      }
      setChainId(pending)
    } finally {
      setPending(null)
      setConfirming(false)
    }
  }

  return (
    <>
      <div ref={ref} className={cn("relative", className)}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-xs font-medium transition-colors",
            active.isTestnet
              ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:border-amber-500/60"
              : "border-border bg-surface-1 text-muted-foreground hover:border-purple-border hover:text-foreground",
          )}
        >
          {active.isTestnet ? (
            <FlaskConical className="h-3.5 w-3.5" />
          ) : (
            <Network className="h-3.5 w-3.5" />
          )}
          <span>{active.shortName}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open && "-rotate-180",
            )}
          />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute left-0 md:left-auto md:right-0 top-full mt-2 w-64 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden z-50"
          >
            <div className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              Network
            </div>
            {SWITCHABLE.map((id) => {
              const chain = CHAINS[id]
              const isActive = chain.id === active.id
              return (
                <button
                  key={chain.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => requestSwitch(chain.id)}
                  className={cn(
                    "w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors",
                    isActive ? "bg-primary/10" : "hover:bg-surface-2",
                  )}
                >
                  <div
                    className={cn(
                      "w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5",
                      chain.isTestnet
                        ? "bg-amber-500/10 text-amber-800 dark:text-amber-400"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {chain.isTestnet ? (
                      <FlaskConical className="h-3.5 w-3.5" />
                    ) : (
                      <Network className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{chain.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
                      {chain.ticker}
                    </p>
                  </div>
                  {isActive && <Check className="w-4 h-4 text-primary flex-shrink-0 mt-1" />}
                </button>
              )
            })}
            <div className="px-3 py-2.5 border-t border-border text-[11px] text-muted-foreground leading-relaxed">
              One network at a time. Switching disconnects your wallet -
              you&apos;ll reconnect for the new chain.
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={pending != null}
        onOpenChange={(o) => {
          if (!o && !confirming) setPending(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-300" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <DialogTitle>
                  Switch to {pending ? CHAINS[pending].shortName : ""}?
                </DialogTitle>
                <DialogDescription>
                  Networks are isolated. Switching disconnects your
                  wallet and signs you out.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={confirming}
              className="px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmSwitch()}
              disabled={confirming}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors disabled:opacity-50"
            >
              {confirming ? "Switching…" : "Switch network"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

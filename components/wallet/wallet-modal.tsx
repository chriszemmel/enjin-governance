"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { WalletDialog as WalletDialogComponent } from "./wallet-dialog"

type Dialog = typeof WalletDialogComponent

let loaded: Dialog | null = null
let loading: Promise<Dialog> | null = null

/** The dialog's code, fetched once; a failed fetch is tried again next time. */
function loadDialog(): Promise<Dialog> {
  if (loaded) return Promise.resolve(loaded)
  loading ??= import("./wallet-dialog")
    .then((m) => (loaded = m.WalletDialog))
    .finally(() => (loading = null))
  return loading
}

let preloaded = false

/** Fetch the dialog's code once the page is idle, so opening it is instant. */
function preloadWhenIdle() {
  if (preloaded) return
  preloaded = true
  const load = () => void loadDialog().catch(() => (preloaded = false))
  if ("requestIdleCallback" in window) window.requestIdleCallback(load, { timeout: 5_000 })
  else setTimeout(load, 2_000)
}

/**
 * The connect / wallet dialog. Its code - the connector list, the
 * WalletConnect QR code - isn't part of the page: it loads when the page
 * is idle or when the dialog first opens, whichever comes first, and stays
 * mounted from then on. If it can't be fetched (offline), opening it says
 * so and the next attempt fetches it again.
 */
export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [WalletDialog, setWalletDialog] = useState<Dialog | null>(null)
  useEffect(preloadWhenIdle, [])
  useEffect(() => {
    if (!open || WalletDialog) return
    let live = true
    loadDialog().then(
      (dialog) => live && setWalletDialog(() => dialog),
      () => {
        if (!live) return
        toast.error("The wallet dialog couldn't load", {
          description: "Check your connection and try again.",
        })
        onClose()
      },
    )
    return () => {
      live = false
    }
  }, [open, WalletDialog, onClose])
  return WalletDialog ? <WalletDialog open={open} onClose={onClose} /> : null
}

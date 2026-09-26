"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"

const loadDialog = () => import("./wallet-dialog").then((m) => m.WalletDialog)
const WalletDialog = dynamic(loadDialog, { ssr: false })

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
 * mounted from then on.
 */
export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [used, setUsed] = useState(open)
  if (open && !used) setUsed(true)
  useEffect(preloadWhenIdle, [])
  return used ? <WalletDialog open={open} onClose={onClose} /> : null
}

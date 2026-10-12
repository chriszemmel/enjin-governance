"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  LogOut,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useWallet, useWalletActions } from "@/lib/wallet/use-wallet"
import { useWalletStore } from "@/lib/wallet/store"
import {
  CONNECTOR_REGISTRY,
  type ConnectorMeta,
  getConnectorMeta,
} from "@/lib/wallet/connector-registry"
import type { ConnectedSession, ConnectorId, DetectionState } from "@/lib/wallet/connectors/types"
import { buildEnjinWalletDeepLink, isMobileUserAgent } from "@/lib/wallet/deep-link"
import { encodeForChain, samePublicKey, shortenAddress } from "@/lib/chain/ss58"
import { useActiveChain } from "@/lib/chain/use-chain"
import { type ChainId } from "@/lib/chain/chains"
import { useMe, useSignOut } from "@/lib/query/hooks/use-session"
import {
  type PublicProfile,
  usePublicProfile,
  usePublicProfiles,
} from "@/lib/query/hooks/use-profile"
import { PolkadotIdenticon } from "@/components/profile/identicon"
import { useModalFocus } from "@/lib/utils/use-modal-focus"
import { BrandedQr } from "./branded-qr"

/**
 * Re-encode an address to the active chain's SS58 prefix for display.
 * Polkadot extension accounts come back in the generic substrate
 * prefix (42 → "5...") which is confusing on an Enjin-prefix chain.
 * Falls back to the raw address if the input can't be decoded.
 */
function displayAddress(address: string, chainId: ChainId): string {
  try {
    return encodeForChain(address, chainId)
  } catch {
    return address
  }
}

interface WalletModalProps {
  open: boolean
  onClose: () => void
}

type ModalView =
  | { kind: "list" }
  | { kind: "wc-qr"; meta: ConnectorMeta; uri: string }
  | { kind: "connecting"; meta: ConnectorMeta }
  | { kind: "error"; meta: ConnectorMeta; message: string }
  | {
      kind: "pick-account"
      meta: ConnectorMeta
      session: ConnectedSession
    }

/** Loaded on demand through ./wallet-modal - import `WalletModal` from there. */
export function WalletDialog({ open, onClose }: WalletModalProps) {
  const wallet = useWallet()
  const actions = useWalletActions()
  const chain = useActiveChain()
  const me = useMe()
  const signOut = useSignOut()
  const [view, setView] = useState<ModalView>({ kind: "list" })
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocus(dialogRef, open, onClose)

  /**
   * Switching the active address changes the signing identity. The
   * SIWE session was minted against a specific public key, so a
   * different active address would silently desync from `me` - the
   * source of bugs like "Only the proposer can edit this proposal"
   * when the user picks a different account than the one they signed
   * in with. Clear the session whenever the new address doesn't
   * match the signed-in one; signing back in is one click on /account
   * (or any sign-in CTA) using the new active address.
   */
  const switchActiveAddress = (address: string) => {
    const wasSignedIn = me.data?.address
    if (wasSignedIn && !samePublicKey(wasSignedIn, address)) {
      void signOut.mutateAsync().catch(() => {
        /* logout is best-effort - local cache is reset either way */
      })
    }
    useWalletStore.getState().setActiveAddress(address)
  }

  useEffect(() => {
    if (open) {
      setView({ kind: "list" })
      setCopied(false)
    }
  }, [open])

  if (!open) return null

  const isConnected = wallet.status === "connected" && wallet.activeAddress

  const handleConnectorClick = async (meta: ConnectorMeta, detection: DetectionState) => {
    if (detection === "not-installed" && meta.installUrl) {
      window.open(meta.installUrl, "_blank", "noopener,noreferrer")
      return
    }

    setView({ kind: "connecting", meta })

    try {
      const session = await actions.connect({
        connectorId: meta.id,
        onUri: (uri) => setView({ kind: "wc-qr", meta, uri }),
      })
      // Always show the picker on a fresh connect when there's more than
      // one account - otherwise we silently use accounts[0] which is
      // basically random from the user's perspective.
      if (session.accounts.length > 1) {
        setView({ kind: "pick-account", meta, session })
      } else {
        onClose()
      }
    } catch (err) {
      setView({
        kind: "error",
        meta,
        message: err instanceof Error ? err.message : "Connection failed",
      })
    }
  }

  const handlePickAccount = (address: string) => {
    // A previous sign-in cookie may still be live (user signed in as A,
    // disconnected without signing out, reconnected and picked B). Mirror
    // the switching guard so identity stays consistent across reconnects.
    const wasSignedIn = me.data?.address
    if (wasSignedIn && !samePublicKey(wasSignedIn, address)) {
      void signOut.mutateAsync().catch(() => {})
    }
    useWalletStore.getState().setActiveAddress(address)
    onClose()
  }

  const handleDisconnect = async () => {
    // Disconnecting the wallet should also drop the SIWE session - it
    // was proven against the connection we're tearing down.
    if (me.data) {
      void signOut.mutateAsync().catch(() => {})
    }
    await actions.disconnect()
    onClose()
  }

  const handleCopy = () => {
    if (wallet.activeAddress) {
      navigator.clipboard.writeText(displayAddress(wallet.activeAddress, chain.id))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        aria-label={isConnected ? "Wallet connected" : "Connect a wallet"}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            {view.kind !== "list" && (
              <button
                onClick={() => setView({ kind: "list" })}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                aria-label="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {view.kind === "pick-account"
                  ? "Choose an account"
                  : isConnected && view.kind === "list"
                    ? "Wallet Connected"
                    : view.kind === "wc-qr"
                      ? `Scan with ${view.meta.name}`
                      : view.kind === "connecting"
                        ? `Connecting ${view.meta.name}…`
                        : view.kind === "error"
                          ? "Connection failed"
                          : "Connect a wallet"}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {view.kind === "pick-account"
                  ? `Pick which of your ${view.session.accounts.length} accounts to use`
                  : isConnected && view.kind === "list"
                    ? "Manage your connection"
                    : view.kind === "wc-qr"
                      ? "Open the wallet on your phone and scan the code below"
                      : view.kind === "connecting"
                        ? "Setting up the connection…"
                        : view.kind === "error"
                          ? view.meta.name
                          : "Choose one of our supported providers"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {view.kind === "wc-qr" ? (
          <WalletConnectQrView uri={view.uri} meta={view.meta} />
        ) : view.kind === "connecting" ? (
          <ConnectingView meta={view.meta} />
        ) : view.kind === "error" ? (
          <ErrorView
            message={view.message}
            onRetry={() => handleConnectorClick(view.meta, "installed")}
          />
        ) : view.kind === "pick-account" ? (
          <PickAccountView
            session={view.session}
            meta={view.meta}
            chainId={chain.id}
            onPick={handlePickAccount}
          />
        ) : isConnected ? (
          <ConnectedView
            address={wallet.activeAddress!}
            connectorId={wallet.connectorId!}
            copied={copied}
            onCopy={handleCopy}
            onDisconnect={handleDisconnect}
            onSelectAddress={switchActiveAddress}
            signedInAddress={me.data?.address ?? null}
          />
        ) : (
          <ConnectorList onSelect={handleConnectorClick} />
        )}
      </div>
    </div>
  )
}

function ConnectorList({
  onSelect,
}: {
  onSelect: (meta: ConnectorMeta, detection: DetectionState) => void
}) {
  const [detections, setDetections] = useState<Record<ConnectorId, DetectionState>>(
    () =>
      Object.fromEntries(
        CONNECTOR_REGISTRY.map((c) => [c.id, "installed" as DetectionState]),
      ) as Record<ConnectorId, DetectionState>,
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const results: Partial<Record<ConnectorId, DetectionState>> = {}
      await Promise.all(
        CONNECTOR_REGISTRY.map(async (c) => {
          try {
            results[c.id] = await c.connector.detect()
          } catch {
            results[c.id] = "not-installed"
          }
        }),
      )
      if (!cancelled) setDetections((prev) => ({ ...prev, ...results }))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const featured = useMemo(() => CONNECTOR_REGISTRY.filter((c) => c.featured), [])
  const rest = useMemo(() => CONNECTOR_REGISTRY.filter((c) => !c.featured), [])

  return (
    <div className="px-6 pb-6">
      <div className="space-y-2">
        {featured.map((c) => (
          <ConnectorRow key={c.id} meta={c} detection={detections[c.id]} onSelect={onSelect} />
        ))}
      </div>

      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Browser extensions
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div className="space-y-2">
        {rest.map((c) => (
          <ConnectorRow key={c.id} meta={c} detection={detections[c.id]} onSelect={onSelect} />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground text-center mt-5 leading-relaxed">
        By connecting, you agree this app may request transaction signatures.
      </p>
    </div>
  )
}

function ConnectorRow({
  meta,
  detection,
  onSelect,
}: {
  meta: ConnectorMeta
  detection: DetectionState
  onSelect: (meta: ConnectorMeta, detection: DetectionState) => void
}) {
  const notInstalled = detection === "not-installed"
  return (
    <button
      onClick={() => onSelect(meta, detection)}
      className={cn(
        "w-full flex items-center gap-4 px-4 py-3.5 rounded-xl border text-left transition-all duration-200",
        notInstalled
          ? "border-border bg-surface-1/40 hover:bg-surface-1 hover:border-purple-border/40"
          : "border-border bg-surface-1 hover:border-primary/30 hover:bg-surface-2",
      )}
    >
      <Image
        src={meta.icon}
        alt=""
        width={32}
        height={32}
        className={cn("rounded-lg", notInstalled && "opacity-50")}
      />
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium",
            notInstalled ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {meta.name}
        </p>
        {meta.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {notInstalled ? "Not installed - click to install" : meta.description}
          </p>
        )}
      </div>
      {notInstalled ? (
        <Download className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      ) : (
        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      )}
    </button>
  )
}

function WalletConnectQrView({ uri, meta }: { uri: string; meta: ConnectorMeta }) {
  const [mobile, setMobile] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    setMobile(isMobileUserAgent())
  }, [])

  const isEnjinWallet = meta.id === "enjin-wallet"

  // QR logo follows the connector the user picked: Enjin mark when they
  // chose Enjin Wallet, WalletConnect mark for the generic flow so the
  // QR doesn't pretend to be Enjin-specific when it isn't.
  const qrLogoUrl = isEnjinWallet ? "/brand/enjin-mark.svg" : "/brand/wallets/walletconnect.png"

  /**
   * Generate a clean, logo-free QR PNG for download. We render fresh
   * via QRCode.toDataURL rather than serialising the on-screen SVG -
   * the on-screen version has a carved hole for the logo and skips
   * those modules entirely; a downloaded PNG is most useful when
   * it's a full, undamaged QR (scannable from any printout/screen at
   * any size without level-H error correction having to compensate).
   */
  const downloadQr = async () => {
    setDownloading(true)
    try {
      const QRCode = (await import("qrcode")).default
      const dataUrl = await QRCode.toDataURL(uri, {
        errorCorrectionLevel: "M",
        width: 1024,
        margin: 2,
        color: { dark: "#0a0820", light: "#ffffff" },
      })
      const a = document.createElement("a")
      a.href = dataUrl
      a.download = "walletconnect-qr.png"
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="px-6 pb-6 space-y-3">
      <div className="rounded-2xl bg-white p-3 flex items-center justify-center">
        <BrandedQr uri={uri} logoUrl={qrLogoUrl} />
      </div>

      {mobile && isEnjinWallet && (
        <a
          href={buildEnjinWalletDeepLink(uri)}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors glow-purple-sm"
        >
          <ExternalLink className="w-4 h-4" />
          Open in Enjin Wallet
        </a>
      )}

      {!isEnjinWallet && (
        <button
          type="button"
          onClick={downloadQr}
          disabled={downloading}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-purple-border transition-colors disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          {downloading ? "Preparing…" : "Download QR"}
        </button>
      )}

      <p className="text-xs text-muted-foreground text-center leading-relaxed">
        {isEnjinWallet
          ? "Open Enjin Wallet on your phone and scan, or tap the button above on mobile."
          : "Open any WalletConnect-compatible Polkadot wallet on your phone and scan."}
      </p>
    </div>
  )
}

function ConnectingView({ meta }: { meta: ConnectorMeta }) {
  return (
    <div className="px-6 pb-8 pt-2 flex flex-col items-center text-center gap-4">
      <div className="relative w-16 h-16 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <Image src={meta.icon} alt="" width={44} height={44} className="rounded-xl" />
      </div>
      <p className="text-sm text-muted-foreground">This should only take a moment.</p>
    </div>
  )
}

function PickAccountView({
  session,
  meta,
  chainId,
  onPick,
}: {
  session: ConnectedSession
  meta: ConnectorMeta
  chainId: ChainId
  onPick: (address: string) => void
}) {
  const accounts = session.accounts
  const displayedAddresses = useMemo(
    () => accounts.map((a) => displayAddress(a.address, chainId)),
    [accounts, chainId],
  )
  const profilesQuery = usePublicProfiles(displayedAddresses)
  return (
    <div className="px-6 pb-6 space-y-3">
      <div className="flex items-center gap-3 rounded-xl bg-surface-2 border border-border p-3">
        <Image src={meta.icon} alt="" width={32} height={32} className="rounded-lg flex-shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          {meta.name} shared {accounts.length} account{accounts.length === 1 ? "" : "s"} with the
          app. Pick one to vote and sign with - you can switch later from the wallet menu.
        </p>
      </div>

      <div className="rounded-xl bg-surface-1 border border-border p-3">
        <div className="max-h-80 overflow-y-auto space-y-1 pr-1 -mr-1 [scrollbar-width:thin] overscroll-contain">
          {accounts.map((account) => {
            const displayed = displayAddress(account.address, chainId)
            const profile = profilesQuery.data?.get(displayed) ?? null
            return (
              <button
                key={account.address}
                type="button"
                onClick={() => onPick(account.address)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors min-h-[48px] hover:bg-surface-2 active:bg-surface-2"
              >
                <AccountAvatar address={displayed} size={28} profile={profile} />
                <AccountIdentity address={displayed} walletName={account.name} profile={profile} />
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Avatar for an account row. Uses the user's uploaded profile picture
 * when set, falling through to the Polkadot identicon. If a `profile`
 * prop is supplied (lists batch all rows in one request via
 * `usePublicProfiles`), no per-row request fires; otherwise this falls
 * back to a single-address `usePublicProfile` for one-off callers.
 */
function AccountAvatar({
  address,
  size,
  profile,
}: {
  address: string
  size: number
  profile?: PublicProfile | null
}) {
  const fallback = usePublicProfile(profile === undefined ? address : null)
  const data = profile === undefined ? fallback.data : profile
  const url = data?.avatar_url
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="rounded-full object-cover border border-purple-border flex-shrink-0"
      />
    )
  }
  return <PolkadotIdenticon address={address} size={size} />
}

/**
 * Two-line identity for an account row. Primary line shows the
 * display name plus a dotted `@handle` chip when both are set - so a
 * fully-claimed profile reads as "Chris Zemmel · @chrisz" rather than
 * splitting across lines. Secondary is the shortened address (the
 * source of truth voters care about); suppressed when the primary
 * line is already the address. Falls back through display_name →
 * wallet's local account name → shortened address.
 */
function AccountIdentity({
  address,
  walletName,
  size = "sm",
  profile,
}: {
  address: string
  walletName?: string | null
  size?: "xs" | "sm"
  profile?: PublicProfile | null
}) {
  const fallback = usePublicProfile(profile === undefined ? address : null)
  const data = profile === undefined ? fallback.data : profile
  const displayName = data?.display_name ?? null
  const handle = data?.handle ?? null
  const short = shortenAddress(address)

  const primary = displayName ?? walletName ?? (handle ? `@${handle}` : short)
  const primaryIsAddress = primary === short
  // When both name and handle are set, suffix the handle on the same
  // line so the row still reads as one identity. If primary already
  // resolved to the handle (no display name), skip the suffix.
  const showHandleSuffix = handle != null && primary !== `@${handle}`

  const primaryClass =
    size === "xs"
      ? "text-xs font-medium text-foreground truncate"
      : "text-sm font-semibold text-foreground truncate"
  const secondaryClass = "text-[11px] font-mono text-muted-foreground truncate mt-0.5"

  return (
    <div className="flex-1 min-w-0">
      <p className={cn(primaryClass, primaryIsAddress && "font-mono font-medium")}>
        {primary}
        {showHandleSuffix && (
          <span className="text-muted-foreground font-normal"> · @{handle}</span>
        )}
      </p>
      {!primaryIsAddress && <p className={secondaryClass}>{short}</p>}
    </div>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="px-6 pb-6 space-y-4">
      <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-4 py-3">
        <p className="text-sm text-destructive font-medium">Could not connect</p>
        <p className="text-xs text-muted-foreground mt-1 break-words">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors"
      >
        Try again
      </button>
    </div>
  )
}

function ConnectedView({
  address,
  connectorId,
  copied,
  onCopy,
  onDisconnect,
  onSelectAddress,
  signedInAddress,
}: {
  address: string
  connectorId: ConnectorId
  copied: boolean
  onCopy: () => void
  onDisconnect: () => void
  onSelectAddress: (address: string) => void
  signedInAddress: string | null
}) {
  const meta = getConnectorMeta(connectorId)
  const session = useWalletStore((s) => s.session)
  const accounts = useMemo(() => session?.accounts ?? [], [session?.accounts])
  const activeAccount = accounts.find((a) => a.address === address) ?? null
  const chain = useActiveChain()
  const displayedActive = displayAddress(address, chain.id)
  const signedInHere = signedInAddress != null && samePublicKey(signedInAddress, address)

  const displayedAddresses = useMemo(() => {
    const set = new Set<string>([displayedActive])
    for (const a of accounts) set.add(displayAddress(a.address, chain.id))
    return Array.from(set)
  }, [accounts, chain.id, displayedActive])
  const profilesQuery = usePublicProfiles(displayedAddresses)
  const activeProfile = profilesQuery.data?.get(displayedActive) ?? null

  return (
    <div className="px-6 pb-6 space-y-3">
      <div className="rounded-xl bg-surface-2 border border-border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <AccountAvatar address={displayedActive} size={44} profile={activeProfile} />
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 border-2 border-surface-2"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium inline-flex items-center gap-1.5">
              <Image src={meta.icon} alt="" width={12} height={12} className="rounded-sm" />
              {meta.name}
            </p>
            <AccountIdentity
              address={displayedActive}
              walletName={activeAccount?.name ?? null}
              size="sm"
              profile={activeProfile}
            />
          </div>
        </div>
        <button
          onClick={onCopy}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-surface-3 hover:bg-border text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? "Copied" : "Copy full address"}
        </button>
        <p
          className={cn(
            "text-[11px] inline-flex items-center gap-1.5",
            signedInHere ? "text-green-800 dark:text-green-400" : "text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              signedInHere ? "bg-green-400" : "bg-muted-foreground/50",
            )}
          />
          {signedInHere ? "Signed in" : "Not signed in - comments and edits need a fresh signature"}
        </p>
      </div>

      {accounts.length > 1 && (
        <div className="rounded-xl bg-surface-1 border border-border p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">
            Switch account ({accounts.length}) - switching signs you out
          </p>
          <div className="max-h-64 overflow-y-auto space-y-1 pr-1 -mr-1 [scrollbar-width:thin] overscroll-contain">
            {accounts.map((account) => {
              const isActive = account.address === address
              const displayed = displayAddress(account.address, chain.id)
              const profile = profilesQuery.data?.get(displayed) ?? null
              return (
                <button
                  key={account.address}
                  type="button"
                  onClick={() => onSelectAddress(account.address)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors min-h-[44px]",
                    isActive
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : "hover:bg-surface-2 active:bg-surface-2",
                  )}
                >
                  <AccountAvatar address={displayed} size={24} profile={profile} />
                  <AccountIdentity
                    address={displayed}
                    walletName={account.name}
                    size="xs"
                    profile={profile}
                  />
                  {isActive && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <button
        onClick={onDisconnect}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border hover:border-destructive/40 text-sm font-medium text-muted-foreground hover:text-destructive transition-all duration-200"
      >
        <LogOut className="w-4 h-4" />
        Disconnect
      </button>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpen,
  ChevronDown,
  CircleUser,
  FileText,
  Landmark,
  Menu,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { NetworkSwitcher } from "@/components/layout/network-switcher"
import { EnjinLogo } from "@/components/layout/enjin-logo"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { useDisplayAddress, useWallet } from "@/lib/wallet/use-wallet"
import { getConnectorMeta } from "@/lib/wallet/connector-registry"
import { usePublicProfile } from "@/lib/query/hooks/use-profile"
import { PolkadotIdenticon } from "@/components/profile/identicon"

// Two top-level destinations. "Create" lives as a per-page CTA on
// Proposals and Treasury so it doesn't crowd the menu.
const navLinks = [
  { label: "Proposals", href: "/proposals", icon: FileText },
  { label: "Treasury", href: "/treasury", icon: Landmark },
  { label: "Account", href: "/account", icon: CircleUser },
  { label: "Docs", href: "/docs", icon: BookOpen },
]

export function Nav() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [desktopOpen, setDesktopOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)

  const { status, connectorId, session, activeAddress } = useWallet()
  const { short: addressShort, full: addressFull } = useDisplayAddress()
  const isConnected = status === "connected" && !!addressShort

  const connectorMeta = useMemo(
    () => (connectorId ? getConnectorMeta(connectorId) : null),
    [connectorId],
  )
  const activeAccount = useMemo(
    () => session?.accounts.find((a) => a.address === activeAddress) ?? null,
    [session, activeAddress],
  )
  // Profile for the active address - drives the avatar (uploaded
  // picture → identicon) and supplies display_name / @handle so the
  // nav button reads as the user's identity rather than a raw SS58
  // string. We keep the shortened address as the secondary line so
  // the user can always confirm which key they're acting as, even
  // when the primary line is a friendly display name.
  const profile = usePublicProfile(addressFull)
  const displayName = profile.data?.display_name ?? null
  const handle = profile.data?.handle ?? null
  const navPrimary =
    displayName ?? activeAccount?.name ?? (handle ? `@${handle}` : addressShort)
  const navPrimaryIsAddress = navPrimary === addressShort
  // Join display_name + @handle on the same line with a dot separator
  // when both are set - same pattern as the wallet sheet rows.
  const showNavHandleSuffix = handle != null && navPrimary !== `@${handle}`
  // Address always shows below the identity line; only fall back to
  // the connector name when there's no identity to show at all.
  const navSecondary = navPrimaryIsAddress
    ? (connectorMeta?.name ?? null)
    : addressShort

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", onScroll)
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const openWalletFromMobile = () => {
    setWalletOpen(true)
    setMobileOpen(false)
  }
  const openWalletFromDesktop = () => {
    setWalletOpen(true)
    setDesktopOpen(false)
  }

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
          scrolled
            ? "bg-background/90 backdrop-blur-xl border-b border-border"
            : "bg-transparent",
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-3 group">
              <EnjinLogo className="h-6 w-auto" />
              <span
                aria-hidden
                className="h-6 w-px self-center bg-gradient-to-b from-transparent via-foreground/30 to-transparent"
              />
              <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                Governance
              </span>
            </Link>

            <button
              onClick={() => setDesktopOpen(true)}
              className="hidden md:inline-flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-1 transition-colors"
              aria-label="Open menu"
              aria-expanded={desktopOpen}
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden bg-background border-b border-border px-4 pb-4">
            <nav className="flex flex-col gap-1 pt-2">
              {navLinks.map((link) => {
                const active = pathname === link.href
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                      active ? "text-foreground bg-surface-2" : "text-muted-foreground",
                    )}
                  >
                    <link.icon
                      className={cn("w-4 h-4", active && "text-primary")}
                      strokeWidth={2}
                    />
                    {link.label}
                  </Link>
                )
              })}
              <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-border">
                {isConnected ? (
                  <button
                    onClick={openWalletFromMobile}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-2 border border-border text-left"
                    aria-label="Open wallet menu"
                  >
                    <span className="relative flex-shrink-0">
                      {profile.data?.avatar_url ? (
                        <img
                          src={profile.data.avatar_url}
                          alt=""
                          width={28}
                          height={28}
                          className="w-7 h-7 rounded-full object-cover border border-purple-border"
                        />
                      ) : addressFull ? (
                        <PolkadotIdenticon address={addressFull} size={28} />
                      ) : null}
                      <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 border-2 border-surface-2" />
                    </span>
                    <span className="flex flex-col leading-tight min-w-0 flex-1">
                      <span
                        className={cn(
                          "text-foreground text-sm font-medium truncate",
                          navPrimaryIsAddress && "font-mono",
                        )}
                      >
                        {navPrimary}
                        {showNavHandleSuffix && (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            · @{handle}
                          </span>
                        )}
                      </span>
                      {navSecondary && (
                        <span
                          className={cn(
                            "text-muted-foreground text-xs truncate",
                            navSecondary === addressShort && "font-mono",
                          )}
                        >
                          {navSecondary}
                        </span>
                      )}
                    </span>
                    <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </button>
                ) : (
                  <button
                    onClick={openWalletFromMobile}
                    className="w-full px-5 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
                  >
                    Connect Wallet
                  </button>
                )}
                <NetworkSwitcher className="w-full [&>button]:w-full [&>button]:justify-between" />
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-muted-foreground">Theme</span>
                  <ThemeToggle />
                </div>
              </div>
            </nav>
          </div>
        )}
      </header>

      <Sheet open={desktopOpen} onOpenChange={setDesktopOpen}>
        <SheetContent
          side="right"
          className="bg-background border-l border-border p-0 flex flex-col gap-0"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Pages, wallet, network, and theme.
          </SheetDescription>

          <div className="px-6 pt-6 pb-4 pr-12 flex items-center gap-3">
            <EnjinLogo className="h-6 w-auto" />
            <span
              aria-hidden
              className="h-6 w-px self-center bg-gradient-to-b from-transparent via-foreground/30 to-transparent"
            />
            <span className="text-sm font-medium text-muted-foreground">
              Governance
            </span>
          </div>

          <nav
            className="flex flex-col gap-1 px-3 pb-3 border-b border-border"
            aria-label="Main navigation"
          >
            {navLinks.map((link) => {
              const active =
                pathname === link.href || pathname.startsWith(link.href + "/")
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setDesktopOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "text-foreground bg-surface-2"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-1",
                  )}
                >
                  <link.icon
                    className={cn("w-4 h-4", active && "text-primary")}
                    strokeWidth={2}
                  />
                  {link.label}
                </Link>
              )
            })}
          </nav>

          <div className="px-3 py-3 flex flex-col gap-2">
            {isConnected ? (
              <button
                onClick={openWalletFromDesktop}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-2 border border-border hover:border-purple-border transition-colors text-left"
                aria-label="Open wallet menu"
              >
                <span className="relative flex-shrink-0">
                  {profile.data?.avatar_url ? (
                    <img
                      src={profile.data.avatar_url}
                      alt=""
                      width={28}
                      height={28}
                      className="w-7 h-7 rounded-full object-cover border border-purple-border"
                    />
                  ) : addressFull ? (
                    <PolkadotIdenticon address={addressFull} size={28} />
                  ) : null}
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 border-2 border-surface-2" />
                </span>
                <span className="flex flex-col leading-tight min-w-0 flex-1">
                  <span
                    className={cn(
                      "text-foreground text-sm font-medium truncate",
                      navPrimaryIsAddress && "font-mono",
                    )}
                  >
                    {navPrimary}
                    {showNavHandleSuffix && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        · @{handle}
                      </span>
                    )}
                  </span>
                  {navSecondary && (
                    <span
                      className={cn(
                        "text-muted-foreground text-xs truncate",
                        navSecondary === addressShort && "font-mono",
                      )}
                    >
                      {navSecondary}
                    </span>
                  )}
                </span>
                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            ) : (
              <button
                onClick={openWalletFromDesktop}
                className="w-full px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors glow-purple-sm"
              >
                Connect Wallet
              </button>
            )}

            <NetworkSwitcher className="w-full [&>button]:w-full [&>button]:justify-between" />

            <div className="flex items-center justify-between px-1 mt-1">
              <span className="text-xs text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </>
  )
}

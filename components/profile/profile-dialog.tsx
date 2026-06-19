"use client"

import { useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Check,
  ChevronDown,
  CheckCircle2,
  Copy,
  ExternalLink,
  ShieldAlert,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useActiveChain } from "@/lib/chain/use-chain"
import { subscanAccountUrl } from "@/lib/chain/chains"
import { encodeForChain, samePublicKey } from "@/lib/chain/ss58"
import { usePublicProfile } from "@/lib/query/hooks/use-profile"
import { useMe } from "@/lib/query/hooks/use-session"
import { PolkadotIdenticon } from "./identicon"

export function ProfileDialog({
  open,
  onOpenChange,
  address,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  address: string
}) {
  const chain = useActiveChain()
  const ss58 = (() => {
    try {
      return encodeForChain(address, chain.id)
    } catch {
      return address
    }
  })()
  const profile = usePublicProfile(ss58)
  const me = useMe()
  const [copied, setCopied] = useState(false)

  const displayName = profile.data?.display_name ?? null
  const handle = profile.data?.handle ?? null
  const title = displayName ?? (handle ? `@${handle}` : "Unnamed account")
  const isMe =
    me.data?.address != null && samePublicKey(me.data.address, ss58)
  const isVerified = profile.data?.is_verified === true

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(ss58)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-3rem)] max-w-[calc(100%-3rem)] sm:max-w-md p-6 gap-4 rounded-2xl">
        <DialogHeader>
          <div className="flex flex-col items-center text-center gap-3 pt-2">
            {profile.data?.avatar_url ? (
              <img
                src={profile.data.avatar_url}
                alt=""
                className="w-20 h-20 rounded-full object-cover border border-purple-border"
              />
            ) : (
              <PolkadotIdenticon address={ss58} size={80} />
            )}
            <div className="space-y-1">
              <DialogTitle className="text-lg inline-flex items-center justify-center gap-1.5">
                {title}
                {isVerified && (
                  <CheckCircle2
                    className="w-4 h-4 text-primary"
                    aria-label="Verified"
                  />
                )}
              </DialogTitle>
              {displayName && handle && (
                <p className="text-xs text-muted-foreground">@{handle}</p>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          {profile.data?.bio && (
            <p className="text-sm text-foreground/90 whitespace-pre-wrap text-center leading-relaxed">
              {profile.data.bio}
            </p>
          )}

          <div className="rounded-xl bg-surface-1 border border-border px-3 py-2.5 flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground break-all flex-1 min-w-0">
              {ss58}
            </span>
            <button
              type="button"
              onClick={onCopy}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              aria-label="Copy address"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {!isVerified && (
            <UnverifiedCaution isMe={isMe} onClose={() => onOpenChange(false)} />
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <a
              href={subscanAccountUrl(chain, ss58)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3" />
              Subscan
            </a>
            <Link
              href={`/user/${ss58}`}
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors"
            >
              View full profile
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Brief "names aren't verified" caution with an expandable explainer.
 * Anyone with a connected wallet can set a display name, handle and bio
 * - we don't run any identity check. Trust signals on this client are
 * the on-chain proposal history, voting record and what other addresses
 * have publicly said. "Edit on Account" stays available to self-views
 * because editing your own profile is unrelated to verification.
 */
function UnverifiedCaution({
  isMe,
  onClose,
}: {
  isMe: boolean
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-xl bg-surface-1 border border-border px-3 py-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed flex-1">
          Self-set name and bio - no identity check. Judge by the on-chain
          record and public references, not the label.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 pl-5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Show less" : "Show more"}
        </button>
        {isMe && (
          <Link
            href="/account"
            onClick={onClose}
            className="text-[11px] text-primary hover:text-purple-dim"
          >
            Edit on Account
          </Link>
        )}
      </div>
      {expanded && (
        <p className="text-[11px] text-muted-foreground leading-relaxed pl-5 pt-1 border-t border-border">
          Anyone connecting a wallet here can pick any name, handle and bio
          - we don&apos;t verify it. Credibility on this client comes from
          things the chain (or other addresses) actually record: the
          referenda an address has filed, how it has voted, and what other
          accounts have publicly said about it. Treat the name as a
          convenient label; the SS58 address is the ground truth.
        </p>
      )}
    </div>
  )
}

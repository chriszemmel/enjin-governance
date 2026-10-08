"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  ExternalLink,
  Loader2,
  LogOut,
  Pencil,
  Send,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { Avatar } from "@/components/account/avatar"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { LockedBalancePanel } from "@/components/governance/locked-balance-panel"
import { ReservedDepositsPanel } from "@/components/governance/reserved-deposits-panel"
import { DelegationPanel } from "@/components/governance/delegation-panel"
import {
  useMe,
  useNoncePrefetch,
  useSignIn,
  useSignOut,
} from "@/lib/query/hooks/use-session"
import {
  useUpdateProfile,
  useUploadAvatar,
} from "@/lib/query/hooks/use-profile"
import {
  useCancelDraft,
  useDeleteDraft,
  useMyDrafts,
  type MyDraft,
  type MyDraftStatus,
} from "@/lib/query/hooks/use-my-drafts"
import { useActiveChain } from "@/lib/chain/use-chain"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { buildSignRequestDeepLink } from "@/lib/wallet/deep-link"
import { encodeForChain, shortenAddress } from "@/lib/chain/ss58"
import { cn } from "@/lib/utils"
import { formatError } from "@/lib/utils/format-error"

// Match the proposals filter UX: pill row of statuses, default to Live.
const DRAFT_FILTERS: { label: string; value: MyDraftStatus | "all" }[] = [
  { label: "Live", value: "on_chain" },
  { label: "Drafts", value: "draft" },
  { label: "Cancelled", value: "cancelled" },
  { label: "All", value: "all" },
]

export default function AccountPage() {
  const chain = useActiveChain()
  // Wait one paint before deciding the wallet is disconnected. The wallet
  // store rehydrates from localStorage on mount; rendering the "connect"
  // CTA against the env default and then snapping to the real session is
  // jarring. `hydrated` flips after the first effect runs (post-hydration).
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    setHydrated(true)
  }, [])
  const { status: walletStatus, activeAddress, session: walletSession, connectorId } = useWallet()
  const isWalletConnected = walletStatus === "connected"
  const [walletOpen, setWalletOpen] = useState(false)
  const [signModalOpen, setSignModalOpen] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const [draftFilter, setDraftFilter] = useState<MyDraftStatus | "all">("on_chain")

  const meQuery = useMe()
  const me = meQuery.data ?? null
  // Mint a nonce in the background so the Sign-in click can fire signRaw
  // without a network hop in between - mirrors the timing of voting and
  // lets iOS Safari auto-open the wallet on the sign-request deep link.
  const prefetchedNonce = useNoncePrefetch()
  const signIn = useSignIn(prefetchedNonce)
  const signOut = useSignOut()

  const isWalletConnect =
    connectorId === "enjin-wallet" || connectorId === "walletconnect"
  const walletMeta = walletDisplayFor(walletSession ?? null)
  const signDeepLinkUrl = buildSignRequestDeepLink({
    peerRedirect:
      (walletSession?.meta?.peerRedirect as string | null | undefined) ?? null,
    sessionTopic:
      (walletSession?.meta?.topic as string | undefined) ?? null,
  })

  const draftsQuery = useMyDrafts(activeAddress, chain)
  const deleteDraft = useDeleteDraft()
  const cancelDraft = useCancelDraft()

  const allDrafts = useMemo(() => draftsQuery.data ?? [], [draftsQuery.data])
  // "Drafts" pill groups draft + submitted (unfinished things that need
  // the proposer's attention). The other filters map 1:1 to status.
  const filteredDrafts = useMemo(() => {
    if (draftFilter === "all") return allDrafts
    if (draftFilter === "draft") {
      return allDrafts.filter(
        (d) => d.status === "draft" || d.status === "submitted",
      )
    }
    return allDrafts.filter((d) => d.status === draftFilter)
  }, [allDrafts, draftFilter])

  const draftCounts = useMemo(() => {
    const counts: Record<MyDraftStatus | "all", number> = {
      all: allDrafts.length,
      draft: 0,
      submitted: 0,
      on_chain: 0,
      failed: 0,
      cancelled: 0,
    }
    for (const d of allDrafts) counts[d.status] += 1
    return counts
  }, [allDrafts])

  const update = useUpdateProfile()
  const upload = useUploadAvatar()

  const [displayName, setDisplayName] = useState("")
  const [handle, setHandle] = useState("")
  const [bio, setBio] = useState("")
  useEffect(() => {
    setDisplayName(me?.display_name ?? "")
    setHandle(me?.handle ?? "")
    setBio(me?.bio ?? "")
  }, [me])

  const dirty =
    me != null &&
    ((me.display_name ?? "") !== displayName ||
      (me.handle ?? "") !== handle ||
      (me.bio ?? "") !== bio)

  const onSave = async () => {
    try {
      await update.mutateAsync({
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        handle: handle.trim() || null,
      })
      toast.success("Profile saved")
    } catch (e) {
      toast.error("Could not save", {
        description: formatError(e),
      })
    }
  }

  const onAvatar = async (file: File) => {
    try {
      await upload.mutateAsync(file)
      toast.success("Avatar updated")
    } catch (e) {
      toast.error("Could not upload avatar", {
        description: formatError(e),
      })
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-2xl mx-auto space-y-6">
          <header>
            <h1 className="text-2xl font-semibold text-foreground">Account</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your profile, drafts, and sign-in state. Anything you change
              here applies to the wallet you&apos;re currently connected with.
            </p>
          </header>

          {!hydrated ||
          (isWalletConnected && meQuery.isPending) ? (
            <AccountSkeleton />
          ) : !isWalletConnected ? (
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/30 p-5 flex items-start gap-3">
              <Wallet className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  Connect a wallet to manage your profile
                </p>
                <button
                  type="button"
                  onClick={() => setWalletOpen(true)}
                  className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors"
                >
                  Connect Wallet
                </button>
              </div>
            </div>
          ) : !me ? (
            <SignInCard
              busy={signIn.isPending}
              onSignIn={async () => {
                setSignError(null)
                if (isWalletConnect) setSignModalOpen(true)
                try {
                  await signIn.submit()
                  setSignModalOpen(false)
                  toast.success("Signed in")
                } catch (e) {
                  const message = formatError(e)
                  setSignError(message)
                }
              }}
            />
          ) : (() => {
            // The SIWE session stores whatever prefix the wallet handed
            // back at sign-in time. If the user has since switched the
            // active chain, that string can read as the wrong network
            // (e.g. a `cn…` Canary form while they're on Enjin Relay).
            // Re-encode to the active chain's prefix for display so the
            // page reads consistently with the chain selector.
            const displayAddress = ((): string => {
              try {
                return encodeForChain(me.address, chain.id)
              } catch {
                return me.address
              }
            })()
            return (
            <>
              <section className="rounded-2xl bg-card border border-border p-6 space-y-5">
                <div className="flex items-center gap-4">
                  <Avatar
                    url={me.avatar_url}
                    address={me.address}
                    fallback={me.display_name ?? me.handle ?? me.address}
                    size="xl"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-foreground truncate">
                      {me.display_name ?? me.handle ?? shortenAddress(displayAddress)}
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground mt-0.5 break-all">
                      {displayAddress}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <AvatarUploader busy={upload.isPending} onPick={onAvatar} />
                  <Link
                    href={`/user/${displayAddress}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-purple-border transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Public view
                  </Link>
                </div>

                <Field
                  label="Display name"
                  value={displayName}
                  onChange={setDisplayName}
                  maxLength={80}
                  placeholder="How you want to appear in comments + voter lists"
                />
                <Field
                  label="Handle"
                  value={handle}
                  onChange={(v) => setHandle(v.toLowerCase())}
                  maxLength={32}
                  placeholder="lowercase, 3-32 chars, a-z 0-9 _"
                  mono
                  hint="@handle appears next to your comments."
                />
                <Field
                  label="Bio"
                  value={bio}
                  onChange={setBio}
                  multiline
                  rows={3}
                  maxLength={500}
                  placeholder="Optional. 1-2 lines."
                />

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => void signOut.mutateAsync()}
                    className="inline-flex items-center gap-1.5 text-xs text-destructive hover:text-red-300 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign out
                  </button>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={!dirty || update.isPending}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {update.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    Save profile
                  </button>
                </div>
              </section>

              <section className="rounded-2xl bg-card border border-border p-6">
                <h2 className="text-sm font-semibold text-foreground mb-3">
                  Your proposals on {chain.shortName}
                </h2>

                <div className="flex items-center gap-1 flex-wrap mb-4">
                  {DRAFT_FILTERS.map((f) => {
                    const count =
                      f.value === "draft"
                        ? draftCounts.draft + draftCounts.submitted
                        : draftCounts[f.value]
                    return (
                      <button
                        key={f.value}
                        onClick={() => setDraftFilter(f.value)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 inline-flex items-center gap-1.5",
                          draftFilter === f.value
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-surface-2",
                        )}
                      >
                        {f.label}
                        <span
                          className={cn(
                            "text-[10px] font-mono",
                            draftFilter === f.value
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground",
                          )}
                        >
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {draftsQuery.isPending ? (
                  <ul className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <li
                        key={i}
                        className="h-14 rounded-lg bg-surface-1 border border-border animate-pulse"
                      />
                    ))}
                  </ul>
                ) : allDrafts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    You haven&apos;t filed any proposals on this network yet.{" "}
                    <Link href="/create" className="text-primary hover:text-purple-dim">
                      File one
                    </Link>
                    .
                  </p>
                ) : filteredDrafts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No proposals match this filter.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {filteredDrafts.map((d) => (
                      <DraftListItem
                        key={d.id}
                        draft={d}
                        networkId={chain.id}
                        busy={deleteDraft.isPending || cancelDraft.isPending}
                        onDelete={(id) =>
                          deleteDraft.mutate(
                            { id },
                            {
                              onSuccess: () => toast.success("Proposal removed"),
                              onError: (e) =>
                                toast.error("Could not delete", {
                                  description: formatError(e),
                                }),
                            },
                          )
                        }
                        onCancel={(id) =>
                          cancelDraft.mutate(
                            { id, reason: "Cancelled from account page" },
                            {
                              onSuccess: () => toast.success("Draft cancelled"),
                              onError: (e) =>
                                toast.error("Could not cancel draft", {
                                  description: formatError(e),
                                }),
                            },
                          )
                        }
                      />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )
          })()}

          {hydrated && isWalletConnected && activeAddress && (
            <>
              <DelegationPanel address={activeAddress} />
              <LockedBalancePanel address={activeAddress} />
              <ReservedDepositsPanel address={activeAddress} />
            </>
          )}
        </div>
      </main>
      <Footer />
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <SignRequestModal
        open={signModalOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the sign request in your wallet"
        status={signError ? { kind: "error", message: signError } : { kind: "signing" }}
        deepLinkUrl={signDeepLinkUrl}
        onClose={() => setSignModalOpen(false)}
        onRetry={() => {
          setSignError(null)
          signIn
            .submit()
            .then(() => {
              setSignModalOpen(false)
              toast.success("Signed in")
            })
            .catch((e) => {
              setSignError(formatError(e))
            })
        }}
      />
    </div>
  )
}

function AccountSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-card border border-border p-6 space-y-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-surface-2 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 bg-surface-2 rounded animate-pulse" />
            <div className="h-3 w-64 bg-surface-2 rounded animate-pulse" />
          </div>
        </div>
        <div className="h-9 w-32 bg-surface-2 rounded-lg animate-pulse" />
        <div className="space-y-3">
          <div className="h-3 w-20 bg-surface-2 rounded animate-pulse" />
          <div className="h-9 w-full bg-surface-1 rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          <div className="h-3 w-20 bg-surface-2 rounded animate-pulse" />
          <div className="h-9 w-full bg-surface-1 rounded animate-pulse" />
        </div>
      </div>
      <div className="rounded-2xl bg-card border border-border p-6 space-y-3">
        <div className="h-4 w-48 bg-surface-2 rounded animate-pulse" />
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="h-14 rounded-lg bg-surface-1 border border-border animate-pulse"
            />
          ))}
        </ul>
      </div>
    </div>
  )
}

function draftStatusLabel(d: MyDraft): string {
  switch (d.status) {
    case "draft":
      return "Not signed"
    case "submitted":
      return "Broadcast - not finalised"
    case "on_chain":
      return d.referendum_index != null
        ? `#${d.referendum_index} · on-chain`
        : "On-chain"
    case "cancelled":
      return "Cancelled"
    case "failed":
      return "Failed"
  }
}

function DraftListItem({
  draft,
  busy,
  onDelete,
  onCancel,
  networkId,
}: {
  draft: MyDraft
  busy: boolean
  onDelete: (id: string) => void
  onCancel: (id: string) => void
  networkId: string
}) {
  const isOnChain = draft.status === "on_chain" && draft.referendum_index != null
  const isCancelled = draft.status === "cancelled"
  const isDraft = draft.status === "draft" || draft.status === "submitted"
  // Advanced-composer drafts don't store their call, so the treasury wizard
  // can't resume them - they can only be cancelled (then deleted) and re-filed.
  const isResumable = isDraft && draft.has_spend
  const subtitle = `${draftStatusLabel(draft)}${isDraft && !draft.has_spend ? " · advanced proposal" : ""} · ${new Date(draft.created_at).toLocaleDateString()}`
  return (
    <li className="flex items-center gap-3 p-3 rounded-lg bg-surface-1 border border-border">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{draft.title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
      </div>

      {isResumable && (
        <>
          <Link
            href={`/create?from=${draft.id}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-purple-border transition-colors"
            title="Edit this draft - saves a new bucket URL"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </Link>
          <Link
            href={`/create?from=${draft.id}&go=review`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary border border-purple-border text-[11px] font-medium hover:bg-primary/20 transition-colors"
            title="Submit this draft on-chain"
          >
            <Send className="w-3 h-3" />
            Submit
          </Link>
        </>
      )}

      {isOnChain && (
        <Link
          href={`/proposals/${draft.referendum_index}?network=${networkId}`}
          className="text-muted-foreground hover:text-foreground"
          title="Open referendum"
        >
          <ArrowRight className="w-4 h-4" />
        </Link>
      )}

      {!isOnChain && (
        <a
          href={draft.json_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
          title="Open bucket JSON"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}

      {isDraft && !isResumable && (
        <button
          type="button"
          onClick={() => onCancel(draft.id)}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50"
          title="Cancel this draft"
        >
          <X className="w-3 h-3" />
          Cancel
        </button>
      )}

      {isCancelled && (
        <button
          type="button"
          onClick={() => onDelete(draft.id)}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50"
          title="Delete this proposal row"
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </button>
      )}
    </li>
  )
}

function SignInCard({
  busy,
  onSignIn,
}: {
  busy: boolean
  onSignIn: () => void
}) {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Sign in</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Sign a one-line nonce with your wallet to enable commenting and
        profile editing. No transaction, no fee - the signature only
        proves you control the connected address.
      </p>
      <button
        type="button"
        onClick={onSignIn}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Sign in with wallet
      </button>
    </div>
  )
}

function AvatarUploader({
  busy,
  onPick,
}: {
  busy: boolean
  onPick: (file: File) => void
}) {
  return (
    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-purple-border transition-colors cursor-pointer">
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Upload className="w-3.5 h-3.5" />
      )}
      Change avatar
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
          e.currentTarget.value = ""
        }}
      />
    </label>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  multiline,
  rows = 3,
  maxLength,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  multiline?: boolean
  rows?: number
  maxLength?: number
  mono?: boolean
}) {
  const klass = `w-full px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 ${mono ? "font-mono" : ""} ${multiline ? "resize-y" : ""}`
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          className={klass}
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

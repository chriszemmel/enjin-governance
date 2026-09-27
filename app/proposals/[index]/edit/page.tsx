"use client"

import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { LoadError } from "@/components/layout/load-error"
import {
  AttachmentDropzone,
  type UploadedAttachment,
} from "@/components/create/attachment-dropzone"
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@/components/create/markdown-editor"
import { type ChainId, CHAINS } from "@/lib/chain/chains"
import { samePublicKey } from "@/lib/chain/ss58"
import { useActiveChain, useSetActiveChain } from "@/lib/chain/use-chain"
import type { ProposalJson } from "@/lib/governance/proposal-metadata"
import {
  markdownForAttachment,
  resolveProposalMedia,
} from "@/lib/governance/proposal-media"
import { keyFromPublicUrl } from "@/lib/r2/paths"
import { useEditProposal } from "@/lib/query/hooks/use-edit-proposal"
import { useProposalMetadata } from "@/lib/query/hooks/use-proposal-metadata"
import { useReferendum } from "@/lib/query/hooks/use-referendum"
import { useMe } from "@/lib/query/hooks/use-session"
import { cn } from "@/lib/utils"
import { formatError, friendlyError } from "@/lib/utils/format-error"

// Match the create wizard so an edit can't produce a payload that
// the original submission would have rejected.
const TITLE_MIN = 10
const SUMMARY_MIN = 20
const BODY_MIN = 50

export default function EditProposalPage() {
  // useSearchParams() bails the subtree out of static prerender; the
  // Suspense wrapper satisfies Next's CSR-bailout requirement.
  return (
    <Suspense fallback={null}>
      <EditProposalPageInner />
    </Suspense>
  )
}

function EditProposalPageInner() {
  const params = useParams<{ index: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const indexParam = Array.isArray(params?.index) ? params.index[0] : params?.index
  const index = Number(indexParam)
  const detailHref = `/proposals/${Number.isFinite(index) ? index : ""}`

  // Shareable links: ?network=… forces the active chain to match.
  const setActiveChain = useSetActiveChain()
  const requestedNetwork = searchParams.get("network") as ChainId | null
  useEffect(() => {
    if (!requestedNetwork) return
    if (!(requestedNetwork in CHAINS)) return
    setActiveChain(requestedNetwork)
  }, [requestedNetwork, setActiveChain])

  const chain = useActiveChain()
  const metadataQuery = useProposalMetadata(
    Number.isFinite(index) ? index : null,
  )

  // If the active chain changes after mount, the index almost certainly
  // doesn't map across chains - bounce them back to the listing.
  const previousChainId = useRef(chain.id)
  useEffect(() => {
    if (previousChainId.current !== chain.id) {
      if (requestedNetwork !== chain.id) router.replace("/proposals")
    }
    previousChainId.current = chain.id
  }, [chain.id, requestedNetwork, router])

  const meQuery = useMe()
  const me = meQuery.data ?? null
  const signedIn = me != null

  // A concluded referendum's proposal text is frozen (the server rejects the
  // edit too). Only block when we positively know it's terminal.
  const referendumQuery = useReferendum(Number.isFinite(index) ? index : 0)
  const referendumConcluded =
    referendumQuery.data != null &&
    referendumQuery.data.status.type !== "Ongoing"

  if (!Number.isFinite(index) || index < 0) {
    return (
      <Shell detailHref="/proposals">
        <p className="text-sm text-muted-foreground">
          That doesn&apos;t look like a valid referendum index.
        </p>
      </Shell>
    )
  }

  if (metadataQuery.isPending) {
    return (
      <Shell detailHref={detailHref}>
        <div className="py-10 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading proposal…
        </div>
      </Shell>
    )
  }

  if (metadataQuery.isError) {
    const err = friendlyError(metadataQuery.error)
    return (
      <Shell detailHref={detailHref}>
        <LoadError
          headline={err.headline}
          detail={err.detail}
          technical={err.technical}
          retry={() => metadataQuery.refetch()}
        />
      </Shell>
    )
  }

  const metadata = metadataQuery.data
  if (!metadata) {
    return (
      <Shell detailHref={detailHref}>
        <p className="text-sm text-muted-foreground">
          This referendum has no off-chain metadata to edit.
        </p>
      </Shell>
    )
  }

  // Gate edits on the signed-in identity (session cookie), not the
  // active wallet address. The wallet's active address can switch
  // freely with no re-sign - using it for ownership would let the UI
  // show the editor for an address the server-side check (which
  // compares against session) would then reject. Compare by public
  // key so a wallet on a different SS58 prefix than the one stored at
  // submission still matches.
  if (meQuery.isPending) {
    return (
      <Shell detailHref={detailHref}>
        <div className="py-10 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Checking sign-in…
        </div>
      </Shell>
    )
  }
  const isProposer =
    me != null && samePublicKey(me.address, metadata.proposer_address)
  if (!isProposer) {
    return (
      <Shell detailHref={detailHref}>
        <div className="rounded-2xl bg-card border border-border p-6 space-y-3">
          {!me ? (
            <>
              <p className="text-sm font-semibold text-foreground">
                Only the proposer can edit this proposal
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <Link
                  href={`/account?next=${encodeURIComponent(`/proposals/${metadata.referendum_index}/edit?network=${metadata.network}`)}`}
                  className="font-medium text-primary hover:text-purple-dim"
                >
                  Sign in
                </Link>{" "}
                with the wallet that filed referendum #
                {metadata.referendum_index}.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">
                Only the proposer can edit this proposal
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                You&apos;re signed in as a different account. Switch to the
                wallet that filed referendum #{metadata.referendum_index} and
                sign in again.
              </p>
              <Link
                href={detailHref}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-purple-dim"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to the proposal
              </Link>
            </>
          )}
        </div>
      </Shell>
    )
  }

  if (referendumConcluded) {
    return (
      <Shell detailHref={detailHref}>
        <div className="rounded-2xl bg-card border border-border p-6 space-y-3">
          <p className="text-sm font-semibold text-foreground">
            This referendum has concluded
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Its proposal text is the record of what was decided and can no
            longer be edited.
          </p>
          <Link
            href={detailHref}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-purple-dim"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to the proposal
          </Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell detailHref={detailHref}>
      <EditForm
        metadata={metadata}
        signedIn={signedIn}
        sessionLoading={meQuery.isPending}
        onSaved={() => router.push(detailHref)}
        detailHref={detailHref}
      />
    </Shell>
  )
}

function EditForm({
  metadata,
  signedIn,
  sessionLoading,
  onSaved,
  detailHref,
}: {
  metadata: ReturnType<typeof useProposalMetadata>["data"] & object
  signedIn: boolean
  sessionLoading: boolean
  onSaved: () => void
  detailHref: string
}) {
  const [title, setTitle] = useState(metadata.title)
  const [summary, setSummary] = useState(metadata.summary ?? "")
  const [bodyMarkdown, setBodyMarkdown] = useState(metadata.body_markdown)
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])

  // Pull the latest canonical JSON so we can seed attachments (which the
  // by-index endpoint doesn't return) and recover from any client-side
  // drift since the last fetch.
  const jsonQuery = useQuery<ProposalJson>({
    queryKey: ["proposal-json", metadata.id, metadata.json_sha256],
    queryFn: async () => {
      const res = await fetch(
        `/api/proposals/${metadata.id}/json?v=${metadata.json_sha256}`,
        { cache: "no-store" },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const raw = await res.text()
      return JSON.parse(raw) as ProposalJson
    },
    staleTime: 60_000,
  })

  // Seed the form once when the canonical JSON arrives so we don't
  // clobber in-progress edits if the cache rehydrates mid-typing.
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded || !jsonQuery.data) return
    const json = jsonQuery.data
    setTitle(json.title ?? metadata.title)
    setSummary(json.summary ?? metadata.summary ?? "")
    setBodyMarkdown(json.body_markdown ?? metadata.body_markdown)
    setAttachments(
      (json.attachments ?? []).map((a) => ({
        bucket_key: keyFromPublicUrl(a.url),
        url: a.url,
        sha256: a.sha256,
        size_bytes: a.size_bytes,
        content_type: a.content_type,
        name: a.name,
      })),
    )
    setSeeded(true)
  }, [seeded, jsonQuery.data, metadata])

  const edit = useEditProposal()
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const media = useMemo(
    () => resolveProposalMedia(attachments, metadata.network, metadata.id),
    [attachments, metadata.network, metadata.id],
  )

  const titleTrimmed = title.trim()
  const summaryTrimmed = summary.trim()
  const bodyTrimmed = bodyMarkdown.trim()

  const dirty =
    seeded &&
    (title !== (jsonQuery.data?.title ?? metadata.title) ||
      summary !== (jsonQuery.data?.summary ?? metadata.summary ?? "") ||
      bodyMarkdown !==
        (jsonQuery.data?.body_markdown ?? metadata.body_markdown) ||
      attachmentsChanged(jsonQuery.data?.attachments ?? [], attachments))

  const titleError =
    titleTrimmed.length === 0
      ? "Title is required."
      : titleTrimmed.length < TITLE_MIN
        ? `Title must be at least ${TITLE_MIN} characters (currently ${titleTrimmed.length}).`
        : null
  const summaryError =
    summaryTrimmed.length > 0 && summaryTrimmed.length < SUMMARY_MIN
      ? `Summary must be at least ${SUMMARY_MIN} characters or left blank (currently ${summaryTrimmed.length}).`
      : null
  const bodyError =
    bodyTrimmed.length > 0 && bodyTrimmed.length < BODY_MIN
      ? `Body must be at least ${BODY_MIN} characters or left blank (currently ${bodyTrimmed.length}).`
      : null
  const validationError = titleError ?? summaryError ?? bodyError

  const canSubmit =
    seeded &&
    dirty &&
    !edit.isPending &&
    signedIn &&
    validationError == null

  const onSave = async () => {
    if (!canSubmit) return
    try {
      await edit.mutateAsync({
        id: metadata.id,
        title: titleTrimmed,
        summary: summaryTrimmed ? summaryTrimmed : null,
        body_markdown: bodyMarkdown,
        attachments,
      })
      toast.success("Proposal updated")
      onSaved()
    } catch (e) {
      toast.error("Could not save", { description: formatError(e) })
    }
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">
          Edit referendum{" "}
          <span className="font-mono text-muted-foreground">
            #{metadata.referendum_index}
          </span>
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Off-chain only. Saves overwrite the bucket JSON - the proposal page
          will mark this referendum as edited. Spend, beneficiary, preimage,
          and the on-chain hash cannot be edited.
        </p>
      </header>

      {!signedIn && !sessionLoading && (
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/30 p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            <Link
              href={`/account?next=${encodeURIComponent(`/proposals/${metadata.referendum_index}/edit?network=${metadata.network}`)}`}
              className="font-medium text-primary hover:text-purple-dim underline-offset-2 hover:underline"
            >
              Sign in
            </Link>{" "}
            with the wallet that filed this proposal to save edits.
          </p>
        </div>
      )}

      {jsonQuery.isPending ? (
        <div className="rounded-2xl bg-card border border-border p-12 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading current JSON…
        </div>
      ) : jsonQuery.isError ? (
        <div className="rounded-2xl bg-card border border-border p-6 text-sm text-destructive">
          Could not load the current proposal JSON.
        </div>
      ) : (
        <div className="rounded-2xl bg-card border border-border p-5 sm:p-6 space-y-5">
          <Field
            label="Title"
            hint={`${title.length}/200`}
            error={titleError}
          >
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={`Clear, descriptive title (≥ ${TITLE_MIN} chars)`}
              className={cn(inputClass, titleError && inputErrorClass)}
            />
          </Field>

          <Field
            label="Summary"
            hint={`${summary.length}/500`}
            error={summaryError}
          >
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={500}
              placeholder={`One-line description (≥ ${SUMMARY_MIN} chars, or blank)`}
              className={cn(inputClass, summaryError && inputErrorClass)}
            />
          </Field>

          <MarkdownEditor
            ref={editorRef}
            label="Full proposal"
            value={bodyMarkdown}
            onChange={setBodyMarkdown}
            rows={12}
            maxLength={100_000}
            placeholder={`Full body (≥ ${BODY_MIN} chars, or blank)`}
            hint={`${bodyMarkdown.length.toLocaleString("en-US")}/100,000 · markdown`}
            error={bodyError}
            media={media}
          />

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Attachments</p>
            <AttachmentDropzone
              proposalId={metadata.id}
              network={metadata.network as ChainId}
              attachments={attachments}
              onChange={setAttachments}
              disabled={edit.isPending}
              deleteOnRemove
              confirmRemove="Delete this file from storage? The proposal page will say you removed it. This can't be undone."
              onInsert={(att) =>
                editorRef.current?.insert(markdownForAttachment(att), {
                  block: att.content_type.startsWith("image/"),
                })
              }
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <Link
          href={detailHref}
          className="px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSubmit}
          title={validationError ?? undefined}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {edit.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : null}
          Save changes
        </button>
      </div>
    </div>
  )
}

function Shell({
  detailHref,
  children,
}: {
  detailHref: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-3xl mx-auto">
          <Link
            href={detailHref}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to proposal
          </Link>
          {children}
        </div>
      </main>
      <Footer />
    </div>
  )
}

const inputClass =
  "w-full px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"

const inputErrorClass =
  "border-destructive/60 focus:border-destructive/80 focus:ring-destructive/20"

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">{label}</label>
        {hint && (
          <span
            className={cn(
              "text-[10px] tabular-nums",
              error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {hint}
          </span>
        )}
      </div>
      {children}
      {error && (
        <p className="text-[11px] text-destructive leading-snug">{error}</p>
      )}
    </div>
  )
}

function attachmentsChanged(
  before: ReadonlyArray<{ url: string; sha256: string }>,
  after: ReadonlyArray<{ url: string; sha256: string }>,
): boolean {
  if (before.length !== after.length) return true
  for (let i = 0; i < before.length; i += 1) {
    if (before[i]?.url !== after[i]?.url) return true
    if (before[i]?.sha256 !== after[i]?.sha256) return true
  }
  return false
}

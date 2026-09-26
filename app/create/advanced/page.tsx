"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, FileCode2, Info, Loader2, ShieldAlert, Upload } from "lucide-react"
import { toast } from "sonner"
import type { ApiPromise } from "@polkadot/api"
import { hexToU8a, u8aToHex } from "@polkadot/util"
import { blake2AsHex } from "@polkadot/util-crypto"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { PlaceDepositButton } from "@/components/governance/place-deposit-button"
import { AddressFormatDialog } from "@/components/create/address-format-dialog"
import {
  AttachmentDropzone,
  type UploadedAttachment,
} from "@/components/create/attachment-dropzone"
import { EnactmentField } from "@/components/create/enactment-field"
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/create/markdown-editor"
import { VoterPreview } from "@/components/create/voter-preview"
import { StepBar, type DraftResponse } from "@/components/create/create-ui"
import { cn } from "@/lib/utils"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { parseTokenAmount } from "@/lib/chain/format"
import {
  encodeForChain,
  inspectAddress,
  isValidAddressForChain,
  samePublicKey,
} from "@/lib/chain/ss58"
import {
  buildProposalCall,
  PROPOSAL_KIND_META,
  SUBMIT_ORIGINS,
  type ProposalCallSpec,
  type ProposalKind,
} from "@/lib/governance/proposal-calls"
import { attachMetadataToExisting, buildProposalBatch } from "@/lib/governance/proposal-batch"
import { extractReferendumIndex } from "@/lib/governance/referenda"
import { canInline, hashCall } from "@/lib/governance/preimage"
import {
  DEFAULT_ENACTMENT,
  resolveEnactment,
  validateEnactment,
  type EnactmentChoice,
} from "@/lib/governance/enactment"
import { formatTrackName } from "@/lib/governance/display"
import type { ProposalCallMeta } from "@/lib/governance/proposal-metadata"
import { markdownForAttachment, resolveProposalMedia } from "@/lib/governance/proposal-media"
import { findTrack } from "@/lib/governance/tracks"
import { pickOriginForAmount } from "@/lib/governance/treasury"
import { confirmWithRetry } from "@/lib/governance/confirm-client"
import { useApi } from "@/lib/query/hooks/use-api"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import { usePreimage, usePreimageStatus } from "@/lib/query/hooks/use-preimage"
import { useProposalMetadata } from "@/lib/query/hooks/use-proposal-metadata"
import { useReferendum } from "@/lib/query/hooks/use-referendum"
import { useReferendumCount } from "@/lib/query/hooks/use-referenda"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useWallet } from "@/lib/wallet/use-wallet"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { useEnsureSignedIn } from "@/lib/wallet/use-ensure-signed-in"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { readApiError } from "@/lib/utils/api-error"
import { formatError } from "@/lib/utils/format-error"

const KIND_ORDER: ProposalKind[] = [
  "treasurySpend",
  "cancelReferendum",
  "killReferendum",
  "whitelistCall",
  "runtimeUpgrade",
  "remark",
  "rawCall",
]

const DEFAULT_KIND: ProposalKind = "cancelReferendum"

// Same floors as the treasury wizard: every referendum gets a real title and
// a summary for list views; the full text is optional here.
const TITLE_MIN = 10
const SUMMARY_MIN = 20

/** Index into SUBMIT_ORIGINS of a kind's suggested origin, or 0 (Root). */
function suggestedOriginIdx(kind: ProposalKind): number {
  const sugg = PROPOSAL_KIND_META[kind].suggestedOrigin
  if (!sugg) return 0
  const i = SUBMIT_ORIGINS.findIndex((o) => JSON.stringify(o.origin) === JSON.stringify(sugg))
  return i >= 0 ? i : 0
}

/** Label of a raw origin object: { Origins: "X" } → "X", { System: "Root" } → "Root". */
function originLabel(origin: unknown): string | null {
  if (!origin || typeof origin !== "object") return null
  const inner = Object.values(origin as Record<string, unknown>)[0]
  return typeof inner === "string" ? inner : null
}

type Fields = {
  amount: string
  beneficiary: string
  index: string
  callHash: string
  codeHex: string
  remarkText: string
  rawHex: string
}

const EMPTY_FIELDS: Fields = {
  amount: "",
  beneficiary: "",
  index: "",
  callHash: "",
  codeHex: "",
  remarkText: "",
  rawHex: "",
}

type RuntimeFile = {
  name: string
  size: number
  hex: `0x${string}`
  codeHash: `0x${string}`
}

const isHex = (s: string, exactBytes?: number) => {
  if (!/^0x[0-9a-fA-F]*$/.test(s)) return false
  if (s.length % 2 !== 0) return false
  if (exactBytes != null && s.length !== 2 + exactBytes * 2) return false
  return true
}

type Mode = "new" | "existing"
type Step = "create" | "review" | "submit"

export default function AdvancedCreatePage() {
  const chain = useActiveChain()
  const apiQuery = useApi()
  const currentBlockQuery = useCurrentBlock()
  const tracksQuery = useTracks()
  const { status: walletStatus, session, activeAddress } = useWallet()
  const isConnected = walletStatus === "connected" && !!activeAddress
  const walletMeta = walletDisplayFor(session ?? null)
  const sign = useSignFlow()
  const { ensureSignedIn, signInModal } = useEnsureSignedIn({
    isWalletConnect: sign.isWalletConnect,
  })

  const [mode, setMode] = useState<Mode>("new")
  const [step, setStep] = useState<Step>("create")
  const [kind, setKind] = useState<ProposalKind>(DEFAULT_KIND)
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS)
  const [runtimeFile, setRuntimeFile] = useState<RuntimeFile | null>(null)
  const [pasteHex, setPasteHex] = useState(false)
  const [originIdx, setOriginIdx] = useState<number>(() => suggestedOriginIdx(DEFAULT_KIND))
  const [enactment, setEnactment] = useState<EnactmentChoice>(DEFAULT_ENACTMENT)
  const [walletOpen, setWalletOpen] = useState(false)
  const [submittedIndex, setSubmittedIndex] = useState<number | null>(null)
  const [linkState, setLinkState] = useState<
    | { kind: "idle" }
    | { kind: "linking" }
    | { kind: "linked" }
    | { kind: "failed"; message: string }
  >({ kind: "idle" })

  // Proposal details - the EGOV1 record every proposal type now carries.
  const [proposalId] = useState(() => crypto.randomUUID())
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [body, setBody] = useState("")
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  const [draft, setDraft] = useState<DraftResponse | null>(null)
  const [staging, setStaging] = useState(false)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const media = useMemo(
    () => resolveProposalMedia(attachments, chain.id, proposalId),
    [attachments, chain.id, proposalId],
  )

  // "Add details to an existing referendum"
  const [existingInput, setExistingInput] = useState("")
  const existingIndex = /^\d+$/.test(existingInput) ? Number(existingInput) : -1
  const existingQuery = useReferendum(mode === "existing" ? existingIndex : -1)
  // Referenda that already have details here are edited from their page.
  const existingDetails = useProposalMetadata(
    mode === "existing" && existingIndex >= 0 ? existingIndex : null,
  )

  const setField = (k: keyof Fields, v: string) => setFields((f) => ({ ...f, [k]: v }))

  const beneficiaryInspection = useMemo(
    () => inspectAddress(fields.beneficiary, chain.id),
    [fields.beneficiary, chain.id],
  )
  const ownAddress = useMemo(() => {
    if (!activeAddress) return null
    try {
      return encodeForChain(activeAddress, chain.id)
    } catch {
      return activeAddress
    }
  }, [activeAddress, chain.id])

  // Build the proposal spec (and any field-level error) from the inputs.
  const { spec, fieldError } = useMemo<{
    spec: ProposalCallSpec | null
    fieldError: string | null
  }>(() => {
    try {
      switch (kind) {
        case "treasurySpend": {
          if (!fields.amount.trim()) return { spec: null, fieldError: "Enter an amount." }
          const amount = parseTokenAmount(fields.amount, chain)
          if (amount <= 0n) return { spec: null, fieldError: "Amount must be positive." }
          const inspected = inspectAddress(fields.beneficiary, chain.id)
          if (inspected.status === "foreign") {
            return {
              spec: null,
              fieldError: `Beneficiary is a ${inspected.networkLabel} address. Convert or clear it.`,
            }
          }
          const beneficiary = inspected.status === "native" ? inspected.address : ""
          if (!beneficiary || !isValidAddressForChain(beneficiary, chain.id)) {
            return { spec: null, fieldError: "Enter a valid beneficiary address." }
          }
          return { spec: { kind, amount, beneficiary }, fieldError: null }
        }
        case "cancelReferendum":
        case "killReferendum": {
          const n = Number(fields.index)
          if (!fields.index.trim() || !Number.isInteger(n) || n < 0) {
            return { spec: null, fieldError: "Enter a referendum index." }
          }
          return { spec: { kind, index: n }, fieldError: null }
        }
        case "whitelistCall": {
          if (!isHex(fields.callHash, 32)) {
            return { spec: null, fieldError: "Enter a 32-byte call hash (0x…)." }
          }
          return { spec: { kind, callHash: fields.callHash as `0x${string}` }, fieldError: null }
        }
        case "runtimeUpgrade": {
          if (runtimeFile && !pasteHex) {
            return { spec: { kind, codeHex: runtimeFile.hex }, fieldError: null }
          }
          if (!isHex(fields.codeHex) || fields.codeHex.length < 10) {
            return {
              spec: null,
              fieldError: pasteHex
                ? "Paste the runtime wasm as hex (0x…)."
                : "Choose the runtime .wasm file.",
            }
          }
          return { spec: { kind, codeHex: fields.codeHex as `0x${string}` }, fieldError: null }
        }
        case "remark": {
          if (!fields.remarkText.trim()) return { spec: null, fieldError: "Enter remark text." }
          return { spec: { kind, text: fields.remarkText }, fieldError: null }
        }
        case "rawCall": {
          if (!isHex(fields.rawHex) || fields.rawHex.length < 6) {
            return { spec: null, fieldError: "Paste a SCALE-encoded call (0x…)." }
          }
          return { spec: { kind, callHex: fields.rawHex as `0x${string}` }, fieldError: null }
        }
      }
    } catch (e) {
      return { spec: null, fieldError: formatError(e) }
    }
  }, [kind, fields, chain, runtimeFile, pasteHex])

  // Resolve the submission origin: treasury spends derive their tier from the
  // amount; everything else uses the selected origin (defaulting to the kind's
  // suggestion via the dropdown's initial index).
  const resolvedOrigin = useMemo<{ origin: unknown; label: string } | null>(() => {
    if (kind === "treasurySpend") {
      if (spec?.kind !== "treasurySpend") return null
      const tier = pickOriginForAmount(spec.amount)
      if (!tier) return null
      return { origin: { Origins: tier.origin }, label: tier.origin }
    }
    const picked = SUBMIT_ORIGINS[originIdx] ?? SUBMIT_ORIGINS[0]
    return { origin: picked.origin, label: picked.label }
  }, [kind, spec, originIdx])

  const enactmentError = validateEnactment(enactment, {
    currentBlock: currentBlockQuery.data ?? null,
  })

  // Decode preview: build the call and report inline-vs-preimage + size.
  const preview = useMemo(() => {
    const api = apiQuery.data as ApiPromise | undefined
    if (!api || !spec) return null
    try {
      const call = buildProposalCall(api, spec)
      const bytes = call.toU8a()
      const human = call.toHuman() as { method?: string; section?: string }
      const c = call as unknown as { section?: string; method?: string }
      return {
        section: c.section ?? human.section ?? "?",
        method: c.method ?? human.method ?? "?",
        bytes,
        len: bytes.length,
        inline: canInline(bytes),
        hash: hashCall(bytes),
        hex: u8aToHex(bytes),
        error: null as string | null,
      }
    } catch (e) {
      return {
        section: "",
        method: "",
        bytes: new Uint8Array(),
        len: 0,
        inline: false,
        hash: "0x" as `0x${string}`,
        hex: "0x",
        error: formatError(e),
      }
    }
  }, [apiQuery.data, spec])

  // Runtime upgrades: the hash voters compare with the release build.
  const codeHash = useMemo<`0x${string}` | null>(() => {
    if (spec?.kind !== "runtimeUpgrade") return null
    if (runtimeFile && !pasteHex) return runtimeFile.codeHash
    try {
      return blake2AsHex(hexToU8a(spec.codeHex), 256) as `0x${string}`
    } catch {
      return null
    }
  }, [spec, runtimeFile, pasteHex])

  // ---- existing referendum --------------------------------------------------
  const existing = existingQuery.data ?? null
  const existingOngoing = existing?.status.type === "Ongoing" ? existing.status : null
  const existingRef =
    existingOngoing && "hash" in existingOngoing.proposal ? existingOngoing.proposal : null
  const existingPreimage = usePreimage(existingRef ?? undefined)
  const existingCall = useMemo<{
    section: string
    method: string
    hash: `0x${string}`
    len: number
    inline: boolean
  } | null>(() => {
    if (!existingOngoing) return null
    const p = existingOngoing.proposal
    if ("hash" in p) {
      return {
        section: existingPreimage.data?.section ?? "",
        method: existingPreimage.data?.method ?? "",
        hash: p.hash,
        len: p.len,
        inline: false,
      }
    }
    const api = apiQuery.data as ApiPromise | undefined
    let section = ""
    let method = ""
    try {
      if (api) {
        const call = api.createType("Call", p.bytes) as unknown as {
          section: string
          method: string
        }
        section = call.section
        method = call.method
      }
    } catch {
      // Undecodable inline call: shown by hash only.
    }
    return { section, method, hash: hashCall(p.bytes), len: p.bytes.length, inline: true }
  }, [existingOngoing, existingPreimage.data, apiQuery.data])
  const existingTrackName = useMemo(() => {
    if (!existingOngoing) return null
    const t = findTrack(tracksQuery.data ?? [], existingOngoing.trackId)
    return (
      originLabel(existingOngoing.origin) ??
      (t ? formatTrackName(t.name) : `Track ${existingOngoing.trackId}`)
    )
  }, [existingOngoing, tracksQuery.data])
  const existingProblem: string | null = (() => {
    if (mode !== "existing") return null
    if (existingIndex < 0) return "Enter the referendum number."
    if (existingQuery.isPending) return "Loading the referendum…"
    if (!existing) return `Referendum #${existingIndex} doesn't exist on ${chain.name}.`
    if (!existingOngoing)
      return `Referendum #${existingIndex} is no longer ongoing; its details can't be changed.`
    if (existingDetails.data) {
      return `Referendum #${existingIndex} already has details here. Edit them from its proposal page.`
    }
    if (!activeAddress) return "Connect the wallet that submitted it."
    if (!samePublicKey(existingOngoing.submissionDeposit.who, activeAddress)) {
      return "Only the account that submitted this referendum (and paid its submission deposit) can add its details."
    }
    return null
  })()

  // ---- the call section written into EGOV1 1.2.0 ---------------------------
  const callMeta = useMemo<ProposalCallMeta | null>(() => {
    if (mode === "existing") {
      if (!existingCall || !existingTrackName) return null
      return {
        section: existingCall.section || "unknown",
        method: existingCall.method || "unknown",
        origin: existingTrackName,
        preimage_hash: existingCall.hash,
        preimage_len: existingCall.len,
        inline: existingCall.inline,
        code_hash: null,
      }
    }
    if (!preview || preview.error || !resolvedOrigin) return null
    return {
      section: preview.section,
      method: preview.method,
      origin: resolvedOrigin.label,
      preimage_hash: preview.hash,
      preimage_len: preview.len,
      inline: preview.inline,
      code_hash: codeHash,
    }
  }, [mode, existingCall, existingTrackName, preview, resolvedOrigin, codeHash])

  // ---- validation ------------------------------------------------------------
  const detailsError = (() => {
    const t = title.trim()
    const s = summary.trim()
    if (t.length < TITLE_MIN) return `Title needs at least ${TITLE_MIN} characters.`
    if (s.length < SUMMARY_MIN) return `Summary needs at least ${SUMMARY_MIN} characters.`
    return null
  })()
  const callError =
    mode === "existing"
      ? existingProblem
      : (fieldError ??
        enactmentError ??
        (resolvedOrigin == null ? "No valid submission origin for this amount." : null) ??
        preview?.error ??
        (preview ? null : "Connecting to the chain…"))
  const canReview = isConnected && !detailsError && !callError && callMeta != null && !staging

  // ---- stage the EGOV1 record ------------------------------------------------
  const stage = useCallback(async () => {
    if (!activeAddress || !callMeta) return
    if (!(await ensureSignedIn())) return
    setStaging(true)
    try {
      const treasury = mode === "new" && spec?.kind === "treasurySpend" ? spec : null
      const enact =
        mode === "existing" ? (existingOngoing?.enactment ?? null) : resolveEnactment(enactment)
      const res = await fetch("/api/proposals/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposalId,
          network: chain.id,
          proposer_address: activeAddress,
          title: title.trim(),
          summary: summary.trim() || null,
          body_markdown: body,
          track: callMeta.origin,
          beneficiary: treasury?.beneficiary ?? null,
          amount_planck: treasury ? treasury.amount.toString() : null,
          preimage_hash: callMeta.preimage_hash,
          preimage_len: callMeta.preimage_len,
          attachments,
          call: callMeta,
          enactment: enact,
          expected_sha256: draft?.json_sha256 ?? null,
        }),
      })
      if (!res.ok) {
        toast.error("Could not save the proposal details", { description: await readApiError(res) })
        return
      }
      setDraft((await res.json()) as DraftResponse)
      setStep("review")
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (e) {
      toast.error("Could not save the proposal details", { description: formatError(e) })
    } finally {
      setStaging(false)
    }
  }, [
    activeAddress,
    callMeta,
    ensureSignedIn,
    mode,
    spec,
    existingOngoing,
    enactment,
    proposalId,
    chain.id,
    title,
    summary,
    body,
    attachments,
    draft,
  ])

  // ---- signing ---------------------------------------------------------------
  // Same fresh-read pattern as the treasury wizard: the referendum index the
  // batch binds metadata to, and whether the call's preimage is already on
  // chain (noting it again would abort the whole batch).
  const referendumCountQuery = useReferendumCount()
  const referendumIndexRef = useRef<number | null>(null)
  useEffect(() => {
    if (referendumCountQuery.data != null) referendumIndexRef.current = referendumCountQuery.data
  }, [referendumCountQuery.data])
  const preimageStatusQuery = usePreimageStatus(
    mode === "new" && preview && !preview.inline ? preview.hash : null,
  )
  const callAlreadyNoted =
    preimageStatusQuery.data === "Unrequested" || preimageStatusQuery.data === "Requested"
  const skipNoteRef = useRef(false)
  useEffect(() => {
    skipNoteRef.current = callAlreadyNoted
  }, [callAlreadyNoted])

  const tx = useExtrinsic({
    // The referendum index is written to our DB on success, so wait for
    // finality (a reorg could otherwise pin the wrong index).
    resolveOn: "finalized",
    build: (api) => {
      if (!draft) throw new Error("Review the proposal before submitting.")
      if (mode === "existing") {
        return attachMetadataToExisting(api, {
          remarkPayload: draft.remark_payload,
          referendumIndex: existingIndex,
        }).calls
      }
      if (!spec || !resolvedOrigin) throw new Error("Complete the proposal fields.")
      const referendumIndex = referendumIndexRef.current
      if (referendumIndex == null) {
        throw new Error("Couldn't read the next referendum index - try again in a moment.")
      }
      return buildProposalBatch(api, {
        callBytes: buildProposalCall(api, spec).toU8a(),
        origin: resolvedOrigin.origin,
        enactment: resolveEnactment(enactment),
        remarkPayload: draft.remark_payload,
        referendumIndex,
        skipNote: skipNoteRef.current,
      }).calls
    },
    async onSuccess({ events, txHash, blockHash }) {
      const index = mode === "existing" ? existingIndex : extractReferendumIndex([...events])
      setSubmittedIndex(index)
      if (!draft || index == null) return
      setLinkState({ kind: "linking" })
      let blockNumber: number | null = null
      try {
        const api = apiQuery.data as ApiPromise | undefined
        const header = api ? await api.rpc.chain.getHeader(blockHash) : null
        blockNumber = header
          ? (header as unknown as { number: { toNumber(): number } }).number.toNumber()
          : null
      } catch {
        // best-effort
      }
      const error = await confirmWithRetry(
        draft.id,
        {
          referendum_index: index,
          tx_hash: txHash,
          block_hash: blockHash,
          block_number: blockNumber,
        },
        ensureSignedIn,
      ).catch((e) => formatError(e))
      setLinkState(error ? { kind: "failed", message: error } : { kind: "linked" })
    },
    onStatus(status) {
      if (status.kind === "error" && /AlreadyNoted/i.test(status.message)) {
        skipNoteRef.current = true
      }
      if (sign.isWalletConnect) return
      if (status.kind === "error") {
        toast.error("Submission failed", { id: "adv-tx", description: status.message })
      }
    },
  })

  const submit = useCallback(async () => {
    if (!isConnected) {
      setWalletOpen(true)
      return
    }
    if (mode === "new") {
      try {
        const res = await preimageStatusQuery.refetch()
        if (res.data === "Unrequested" || res.data === "Requested") skipNoteRef.current = true
      } catch {
        // fall back to the seeded ref
      }
      try {
        const count = await referendumCountQuery.refetch()
        if (count.data != null) referendumIndexRef.current = count.data
      } catch {
        // build throws if the ref is still empty
      }
    }
    setStep("submit")
    sign.open()
    void tx.submit()
  }, [isConnected, mode, preimageStatusQuery, referendumCountQuery, sign, tx])

  const meta = PROPOSAL_KIND_META[kind]
  const readOnly = !isConnected || step !== "create"

  const onRuntimeFile = async (file: File | undefined) => {
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length < 4 || bytes.length > 8 * 1024 * 1024) {
      toast.error("That doesn't look like a runtime", {
        description: "Expected a compressed wasm between a few KB and 8 MB.",
      })
      return
    }
    setRuntimeFile({
      name: file.name,
      size: bytes.length,
      hex: u8aToHex(bytes) as `0x${string}`,
      codeHash: blake2AsHex(bytes, 256) as `0x${string}`,
    })
    setPasteHex(false)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-2xl mx-auto">
          <Link
            href="/create"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to treasury proposal
          </Link>

          <div className="mb-6">
            <h1 className="text-xl font-semibold text-foreground">
              {mode === "new" ? "Advanced proposal" : "Add details to a referendum"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              {mode === "new" ? (
                <>
                  File any OpenGov proposal on {chain.name} - referendum admin, whitelisting,
                  runtime upgrades, remarks, or a raw call - with a title and description voters can
                  read. One signature files the call and links its EGOV1 record on chain.
                </>
              ) : (
                <>
                  For a referendum filed elsewhere (polkadot.js, scripts). Signed by the account
                  that submitted it, while it is still ongoing.
                </>
              )}
            </p>
          </div>

          <StepBar current={step} />

          {step === "create" && mode === "new" && (
            <>
              <div className="rounded-2xl bg-amber-500/5 border border-amber-500/30 p-4 mb-6 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  These proposals enact privileged calls. Pick the correct track origin for the call
                  - an under-powered origin will fail at enactment after the full vote cycle. Review
                  the decoded call before signing.
                </p>
              </div>

              <Section title="Proposal type">
                <div className="grid grid-cols-2 gap-2">
                  {KIND_ORDER.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setKind(k)
                        // Default the origin to the track this call needs (e.g.
                        // cancel → ReferendumCanceller); user can still override.
                        setOriginIdx(suggestedOriginIdx(k))
                      }}
                      className={cn(
                        "text-left px-3 py-2 rounded-lg border text-xs transition-colors",
                        kind === k
                          ? "bg-primary/10 border-purple-border text-foreground"
                          : "bg-surface-1 border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="font-medium block">{PROPOSAL_KIND_META[k].label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">{meta.description}</p>
              </Section>

              <Section title={kind === "runtimeUpgrade" ? "Runtime code" : "Call"}>
                {kind === "treasurySpend" && (
                  <>
                    <TextInput
                      label={`Amount (${chain.ticker})`}
                      value={fields.amount}
                      onChange={(v) => setField("amount", v)}
                      placeholder="e.g. 1000"
                      disabled={readOnly}
                    />
                    <TextInput
                      label="Beneficiary address"
                      value={fields.beneficiary}
                      onChange={(v) => setField("beneficiary", v)}
                      placeholder="en…"
                      mono
                      disabled={readOnly}
                    />
                  </>
                )}
                {(kind === "cancelReferendum" || kind === "killReferendum") && (
                  <TextInput
                    label="Referendum index"
                    value={fields.index}
                    onChange={(v) => setField("index", v)}
                    placeholder="e.g. 42"
                    disabled={readOnly}
                  />
                )}
                {kind === "whitelistCall" && (
                  <TextInput
                    label="Call hash (32-byte H256)"
                    value={fields.callHash}
                    onChange={(v) => setField("callHash", v)}
                    placeholder="0x…"
                    mono
                    disabled={readOnly}
                  />
                )}
                {kind === "runtimeUpgrade" &&
                  (pasteHex ? (
                    <>
                      <TextArea
                        label="Runtime code (wasm hex)"
                        value={fields.codeHex}
                        onChange={(v) => setField("codeHex", v)}
                        placeholder="0x…"
                        disabled={readOnly}
                      />
                      <button
                        type="button"
                        onClick={() => setPasteHex(false)}
                        className="text-[11px] text-primary hover:text-purple-dim"
                      >
                        Choose a .wasm file instead
                      </button>
                    </>
                  ) : (
                    <>
                      <label
                        className={cn(
                          "flex items-center gap-3 rounded-xl border-2 border-dashed border-purple-border bg-primary/5 px-4 py-3",
                          readOnly ? "opacity-60" : "cursor-pointer hover:bg-primary/10",
                        )}
                      >
                        {runtimeFile ? (
                          <FileCode2 className="w-5 h-5 text-primary flex-shrink-0" />
                        ) : (
                          <Upload className="w-5 h-5 text-primary flex-shrink-0" />
                        )}
                        <span className="min-w-0">
                          <span className="block font-mono text-xs text-foreground truncate">
                            {runtimeFile?.name ?? "Choose the runtime .wasm file"}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {runtimeFile
                              ? `${(runtimeFile.size / (1024 * 1024)).toFixed(2)} MB · read in your browser, no hex pasting`
                              : "e.g. enjin_runtime.compact.compressed.wasm"}
                          </span>
                        </span>
                        <input
                          type="file"
                          accept=".wasm,application/wasm"
                          hidden
                          disabled={readOnly}
                          onChange={(e) => {
                            void onRuntimeFile(e.target.files?.[0])
                            e.currentTarget.value = ""
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setPasteHex(true)}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Paste hex instead
                      </button>
                    </>
                  ))}
                {kind === "remark" && (
                  <TextArea
                    label="Remark text"
                    value={fields.remarkText}
                    onChange={(v) => setField("remarkText", v)}
                    placeholder="Anything - recorded on chain, no state change."
                    disabled={readOnly}
                  />
                )}
                {kind === "rawCall" && (
                  <TextArea
                    label="SCALE-encoded call (hex)"
                    value={fields.rawHex}
                    onChange={(v) => setField("rawHex", v)}
                    placeholder="0x…"
                    disabled={readOnly}
                  />
                )}
                {fieldError && isConnected && (
                  <p className="text-[11px] text-destructive mt-1">{fieldError}</p>
                )}
                {preview && !preview.error && resolvedOrigin && (
                  <CallFacts
                    rows={[
                      ["Call", `${preview.section}.${preview.method}`],
                      ...(codeHash ? ([["Code hash", codeHash]] as [string, string][]) : []),
                      ["Track", formatTrackName(resolvedOrigin.label)],
                      [
                        "Size",
                        `${preview.len.toLocaleString("en-US")} bytes · ${preview.inline ? "inline" : "noted as a preimage"}`,
                      ],
                    ]}
                  />
                )}
                {preview?.error && (
                  <p className="text-[11px] text-destructive break-all">{preview.error}</p>
                )}
              </Section>

              <Section title="Submission origin (track)">
                {kind === "treasurySpend" ? (
                  <p className="text-xs text-muted-foreground">
                    Derived from the amount:{" "}
                    <span className="text-primary font-mono">{resolvedOrigin?.label ?? "-"}</span>
                  </p>
                ) : (
                  <>
                    <select
                      value={originIdx}
                      disabled={readOnly}
                      onChange={(e) => setOriginIdx(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-foreground font-mono focus:outline-none focus:border-primary/50 disabled:opacity-50"
                    >
                      {SUBMIT_ORIGINS.map((o, i) => (
                        <option key={o.label} value={i}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                      This call isn&apos;t run directly - it&apos;s enacted by a referendum on the
                      track you pick here, which sets who votes on it and the passing thresholds.{" "}
                      {meta.suggestedOrigin
                        ? `${meta.label} should run on ${SUBMIT_ORIGINS[suggestedOriginIdx(kind)].label}.`
                        : "Pick a track whose authority covers this call - Root can dispatch anything but is the hardest to pass."}
                    </p>
                  </>
                )}
              </Section>

              <Section title="Enactment">
                <EnactmentField
                  value={enactment}
                  error={enactmentError}
                  minEnactment={null}
                  disabled={readOnly}
                  onChange={setEnactment}
                />
              </Section>
            </>
          )}

          {step === "create" && mode === "existing" && (
            <Section title="Referendum">
              <TextInput
                label="Referendum number"
                value={existingInput}
                onChange={(v) => setExistingInput(v.replace(/[^0-9]/g, ""))}
                placeholder="e.g. 212"
                disabled={!isConnected}
              />
              {existingProblem ? (
                <p className="text-[11px] text-muted-foreground">{existingProblem}</p>
              ) : existingCall && existingTrackName ? (
                <CallFacts
                  rows={[
                    [
                      "Call",
                      existingCall.section
                        ? `${existingCall.section}.${existingCall.method}`
                        : existingPreimage.isPending
                          ? "Loading…"
                          : "Not decodable",
                    ],
                    ["Track", formatTrackName(existingTrackName)],
                    [
                      "Preimage",
                      `${existingCall.len.toLocaleString("en-US")} bytes · ${existingCall.inline ? "inline" : existingCall.hash}`,
                    ],
                  ]}
                />
              ) : null}
            </Section>
          )}

          {step === "create" && (
            <Section title="Proposal details" badge="EGOV1">
              <TextInput
                label="Title"
                value={title}
                onChange={setTitle}
                placeholder={`Clear, descriptive title (≥ ${TITLE_MIN} chars)`}
                maxLength={200}
                disabled={!isConnected}
              />
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">Summary</span>
                <textarea
                  value={summary}
                  rows={3}
                  maxLength={500}
                  disabled={!isConnected}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder={`1-3 sentences for list views (≥ ${SUMMARY_MIN} chars)`}
                  className="w-full px-4 py-3 rounded-xl bg-surface-1 border border-border text-sm text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all disabled:opacity-50 resize-y"
                />
              </label>
              <MarkdownEditor
                ref={editorRef}
                label="Full proposal"
                value={body}
                onChange={setBody}
                rows={10}
                maxLength={100_000}
                placeholder="What the call does, why, how it was tested, risks."
                hint={`${body.length.toLocaleString("en-US")}/100,000 · optional · markdown`}
                disabled={!isConnected}
                media={media}
              />
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Attachments (optional)</p>
                <AttachmentDropzone
                  proposalId={proposalId}
                  network={chain.id}
                  attachments={attachments}
                  onChange={setAttachments}
                  beforeUpload={ensureSignedIn}
                  disabled={!isConnected}
                  deleteOnRemove
                  onInsert={(att) =>
                    editorRef.current?.insert(markdownForAttachment(att), {
                      block: att.content_type.startsWith("image/"),
                    })
                  }
                />
              </div>
            </Section>
          )}

          {step === "create" && (
            <>
              {isConnected && (detailsError || callError) && (
                <p className="text-[11px] text-muted-foreground mb-2">
                  {callError ?? detailsError}
                </p>
              )}
              <button
                type="button"
                onClick={() => (isConnected ? void stage() : setWalletOpen(true))}
                disabled={isConnected && !canReview}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {staging && <Loader2 className="w-4 h-4 animate-spin" />}
                {isConnected ? "Review" : "Connect wallet"}
                {isConnected && !staging && <ArrowRight className="w-4 h-4" />}
              </button>
              <button
                type="button"
                // The draft (if any) is kept: staging again updates it in place.
                onClick={() => setMode(mode === "new" ? "existing" : "new")}
                className="w-full mt-4 text-xs text-primary hover:text-purple-dim"
              >
                {mode === "new"
                  ? "Already submitted elsewhere? Add details to an existing referendum →"
                  : "← File a new proposal instead"}
              </button>
            </>
          )}

          {step !== "create" && draft && callMeta && (
            <div className="space-y-4">
              <VoterPreview
                title={title.trim()}
                summary={summary.trim()}
                body={body}
                attachments={attachments}
                network={chain.id}
                proposalId={proposalId}
              />

              <Section title="Call">
                <CallFacts
                  rows={[
                    ["Method", `${callMeta.section}.${callMeta.method}`],
                    ["Track", formatTrackName(callMeta.origin)],
                    ...(callMeta.code_hash
                      ? ([["Code hash", callMeta.code_hash]] as [string, string][])
                      : []),
                    [
                      "Preimage",
                      `${callMeta.preimage_len.toLocaleString("en-US")} bytes · ${callMeta.inline ? "inline" : callMeta.preimage_hash}`,
                    ],
                    ...(mode === "existing"
                      ? ([["Referendum", `#${existingIndex}`]] as [string, string][])
                      : []),
                  ]}
                />
                {callMeta.code_hash && (
                  <p className="flex items-start gap-1.5 rounded-lg border border-border bg-surface-1 p-2.5 text-[11px] text-muted-foreground">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                    Voters can compare this code hash with the srtool build hash in the release
                    notes.
                  </p>
                )}
              </Section>

              <Section title="What you'll sign">
                <ol className="list-decimal pl-5 space-y-1 text-xs text-muted-foreground">
                  {mode === "new" && !callMeta.inline && (
                    <li>
                      Register the call on chain{" "}
                      <span className="font-mono">(preimage.notePreimage)</span>
                      {callAlreadyNoted ? " - already noted, skipped" : ""}
                    </li>
                  )}
                  {mode === "new" && (
                    <li>
                      File the referendum on {formatTrackName(callMeta.origin)}{" "}
                      <span className="font-mono">(referenda.submit)</span>
                    </li>
                  )}
                  <li>
                    Store the pointer to this proposal&apos;s details{" "}
                    <span className="font-mono">(preimage.notePreimage)</span>
                  </li>
                  <li>
                    Link it to the referendum{" "}
                    <span className="font-mono">(referenda.setMetadata)</span>
                  </li>
                </ol>
                <p className="text-[11px] text-muted-foreground">
                  One signature. If any step fails, none apply.
                </p>
              </Section>

              {submittedIndex != null ? (
                <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/30 p-5 space-y-3">
                  <p className="text-sm font-semibold text-foreground">
                    {mode === "new"
                      ? `Referendum #${submittedIndex} submitted`
                      : `Details added to referendum #${submittedIndex}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {linkState.kind === "linking" && "Linking the details on this site…"}
                    {linkState.kind === "linked" &&
                      "Its title and description now show on the proposal page."}
                    {linkState.kind === "failed" &&
                      `On chain, but linking on this site failed: ${linkState.message} You can link it later from your drafts.`}
                  </p>
                  <Link
                    href={`/proposals/${submittedIndex}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:text-purple-dim"
                  >
                    View the proposal <ArrowRight className="w-3 h-3" />
                  </Link>
                  {mode === "new" && (
                    <PlaceDepositButton
                      referendumIndex={submittedIndex}
                      trackName={resolvedOrigin?.label ?? null}
                      chain={chain}
                    />
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("create")}
                    disabled={tx.isSubmitting}
                    className="px-4 py-3 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-surface-1 disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={tx.isSubmitting}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all disabled:opacity-50"
                  >
                    {tx.isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Sign &amp; submit
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      {step === "create" &&
        mode === "new" &&
        kind === "treasurySpend" &&
        beneficiaryInspection.status === "foreign" && (
          <AddressFormatDialog
            input={beneficiaryInspection.input}
            networkLabel={beneficiaryInspection.networkLabel}
            convertedAddress={beneficiaryInspection.address}
            chainShortName={chain.shortName}
            isOwnWallet={beneficiaryInspection.address === ownAddress}
            onConvert={() => setField("beneficiary", beneficiaryInspection.address)}
            onCancel={() => setField("beneficiary", "")}
          />
        )}
      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the proposal in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Proposal submitted on chain"
        successBody="Your referendum is live. Place its decision deposit to start deciding."
        successAt="in-block"
        autoDismiss={false}
        onClose={sign.close}
        onRetry={() => {
          tx.reset()
          void submit()
        }}
      />
      <SignRequestModal
        {...signInModal}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Sign in to save the proposal details"
        deepLinkUrl={sign.deepLinkUrl}
      />
    </div>
  )
}

function Section({
  title,
  badge,
  children,
}: {
  title: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-card border border-border p-5 space-y-3 mb-4">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
        {title}
        {badge && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-mono uppercase tracking-wider">
            {badge}
          </span>
        )}
      </h2>
      {children}
    </div>
  )
}

function CallFacts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono text-foreground break-all">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  disabled,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  disabled?: boolean
  maxLength?: number
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type="text"
        value={value}
        spellCheck={false}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full px-4 py-3 rounded-xl bg-surface-1 border border-border text-sm text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all disabled:opacity-50",
          mono && "font-mono",
        )}
      />
    </label>
  )
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <textarea
        value={value}
        rows={4}
        spellCheck={false}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl bg-surface-1 border border-border text-xs text-foreground font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all disabled:opacity-50 break-all"
      />
    </label>
  )
}

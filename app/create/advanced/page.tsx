"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowRight,
  FileCode2,
  Info,
  Loader2,
  ShieldAlert,
  Upload,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import type { ApiPromise } from "@polkadot/api"
import { u8aToHex } from "@polkadot/util"
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
import { FilingCosts } from "@/components/create/filing-costs"
import { StepBar, type DraftResponse } from "@/components/create/create-ui"
import { cn } from "@/lib/utils"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { getActiveChain, useActiveChain } from "@/lib/chain/use-chain"
import { formatTokenAmount, parseTokenAmount } from "@/lib/chain/format"
import { env } from "@/lib/env"
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
import { canInline, hashCall, noteWouldAbort } from "@/lib/governance/preimage"
import {
  envelopeBytes,
  estimateEnvelopeBytes,
  filingRequirement,
} from "@/lib/governance/filing-deposits"
import {
  DEFAULT_ENACTMENT,
  resolveEnactment,
  validateEnactment,
  type EnactmentChoice,
} from "@/lib/governance/enactment"
import { formatTrackName } from "@/lib/governance/display"
import type { ProposalCallMeta } from "@/lib/governance/proposal-metadata"
import { markdownForAttachment, resolveProposalMedia } from "@/lib/governance/proposal-media"
import { findTrack, findTrackByName } from "@/lib/governance/tracks"
import { pickOriginForAmount } from "@/lib/governance/treasury"
import { confirmWithRetry } from "@/lib/governance/confirm-client"
import {
  chainSubmissionReader,
  findLandedSubmission,
  stagedForMismatch,
  type StagedFor,
} from "@/lib/governance/submission-checks"
import { useApi } from "@/lib/query/hooks/use-api"
import { useBalance } from "@/lib/query/hooks/use-balance"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import { useFilingCosts } from "@/lib/query/hooks/use-filing-costs"
import {
  useEnvelopeNoted,
  usePreimage,
  usePreimageStatus,
} from "@/lib/query/hooks/use-preimage"
import { useProposalMetadata } from "@/lib/query/hooks/use-proposal-metadata"
import { useReferendum } from "@/lib/query/hooks/use-referendum"
import { useReferendumCount } from "@/lib/query/hooks/use-referenda"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useTreasuryTiers } from "@/lib/query/hooks/use-treasury-tiers"
import { useExtrinsic, type TxStatus } from "@/lib/query/hooks/use-tx"
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
  "authorizeUpgrade",
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
  codeHash: string
  remarkText: string
  rawHex: string
}

const EMPTY_FIELDS: Fields = {
  amount: "",
  beneficiary: "",
  index: "",
  callHash: "",
  codeHash: "",
  remarkText: "",
  rawHex: "",
}

/** The runtime wasm whose hash filled the code-hash field. */
type WasmFile = { name: string; size: number }

const isHex = (s: string, exactBytes?: number) => {
  if (!/^0x[0-9a-fA-F]*$/.test(s)) return false
  if (s.length % 2 !== 0) return false
  if (exactBytes != null && s.length !== 2 + exactBytes * 2) return false
  return true
}

type Mode = "new" | "existing"
type Step = "create" | "review" | "submit"

/**
 * What a signed batch was built from, captured in the build closure so the
 * success handler links the draft and index that batch actually carries -
 * not whatever the page holds by the time it finalises.
 */
type BuiltSubmission = {
  mode: Mode
  draft: DraftResponse
  /** The index setMetadata binds: referendumCount() read just before signing. */
  referendumIndex: number
}

export default function AdvancedCreatePage() {
  const chain = useActiveChain()
  const apiQuery = useApi()
  const treasuryTiers = useTreasuryTiers()
  const currentBlockQuery = useCurrentBlock()
  const tracksQuery = useTracks()
  const { status: walletStatus, session, activeAddress } = useWallet()
  const isConnected = walletStatus === "connected" && !!activeAddress
  const balanceQuery = useBalance(activeAddress)
  const filingCosts = useFilingCosts()
  const walletMeta = walletDisplayFor(session ?? null)
  const sign = useSignFlow()
  const { ensureSignedIn, signInModal } = useEnsureSignedIn({
    isWalletConnect: sign.isWalletConnect,
  })

  const [mode, setMode] = useState<Mode>("new")
  const [step, setStep] = useState<Step>("create")
  const [kind, setKind] = useState<ProposalKind>(DEFAULT_KIND)
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS)
  const [wasmFile, setWasmFile] = useState<WasmFile | null>(null)
  const [hashingWasm, setHashingWasm] = useState(false)
  const [originIdx, setOriginIdx] = useState<number>(() => suggestedOriginIdx(DEFAULT_KIND))
  const [enactment, setEnactment] = useState<EnactmentChoice>(DEFAULT_ENACTMENT)
  const [walletOpen, setWalletOpen] = useState(false)
  const [submittedIndex, setSubmittedIndex] = useState<number | null>(null)
  const [linkState, setLinkState] = useState<
    | { kind: "idle" }
    | { kind: "linking" }
    | { kind: "linked" }
    | { kind: "failed"; message: string }
    // A stale index passes setMetadata only for this account's own earlier
    // referendum, which then carries these details instead.
    | { kind: "misbound"; earlierIndex: number }
  >({ kind: "idle" })
  // The batch finalised, but no Submitted event named the new referendum:
  // signing again would file a duplicate, so the button goes away.
  const [indexLost, setIndexLost] = useState(false)
  // A retry found that an earlier attempt's batch had already landed.
  const [recovered, setRecovered] = useState(false)
  // Why the pre-sign check refused to sign (shown like a failed tx).
  const [precheckError, setPrecheckError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Proposal details - the EGOV1 record every proposal type now carries.
  const [proposalId] = useState(() => crypto.randomUUID())
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [body, setBody] = useState("")
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  const [draft, setDraft] = useState<DraftResponse | null>(null)
  // The network and account the draft was staged for: signing is refused
  // once either changed.
  const [stagedFor, setStagedFor] = useState<StagedFor | null>(null)
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
        case "authorizeUpgrade": {
          const codeHash = fields.codeHash.trim()
          if (!isHex(codeHash, 32)) {
            return {
              spec: null,
              fieldError: "Enter the wasm's 32-byte blake2-256 hash (0x…), or pick the .wasm file.",
            }
          }
          return {
            spec: { kind, codeHash: codeHash.toLowerCase() as `0x${string}` },
            fieldError: null,
          }
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
  }, [kind, fields, chain])

  // Resolve the submission origin: treasury spends derive their tier from the
  // amount and the connected runtime's spend limits; everything else uses the
  // selected origin (defaulting to the kind's suggestion via the dropdown's
  // initial index).
  const tierTable = treasuryTiers.table
  const resolvedOrigin = useMemo<{ origin: unknown; label: string; track: string } | null>(() => {
    if (kind === "treasurySpend") {
      if (spec?.kind !== "treasurySpend" || !tierTable) return null
      const tier = pickOriginForAmount(spec.amount, tierTable.tiers)
      if (!tier) return null
      return { origin: { Origins: tier.origin }, label: tier.origin, track: tier.origin }
    }
    const picked = SUBMIT_ORIGINS[originIdx] ?? SUBMIT_ORIGINS[0]
    return { origin: picked.origin, label: picked.label, track: picked.track }
  }, [kind, spec, originIdx, tierTable])

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
  const codeHash = spec?.kind === "authorizeUpgrade" ? spec.codeHash : null

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

  // Sign-in, staging and the pre-sign chain reads all run before tx.submit's
  // own single-flight guard, so the clicks that start them need one too: a
  // second click (or a double-fired tap) mid-way would otherwise prompt a
  // second sign-in or stage again. The ref catches same-tick repeats; the
  // state disables the buttons.
  const preparingRef = useRef(false)
  const [preparing, setPreparing] = useState(false)
  const guarded = useCallback(async (work: () => Promise<void>) => {
    if (preparingRef.current) return
    preparingRef.current = true
    setPreparing(true)
    try {
      await work()
    } finally {
      preparingRef.current = false
      setPreparing(false)
    }
  }, [])

  // ---- deposits ---------------------------------------------------------------
  // What the batch reserves (see filingRequirement): the submission deposit
  // for a new referendum, a preimage deposit for a call that doesn't ride
  // inline and isn't noted yet, and one for the EGOV1 envelope (its length
  // estimated until the details are staged), plus fees and the minimum
  // balance. The track's decision deposit is shown, not required.
  const preimageStatusQuery = usePreimageStatus(
    mode === "new" && preview && !preview.inline ? preview.hash : null,
  )
  const callAlreadyNoted = noteWouldAbort(preimageStatusQuery.data)
  const filingNeeds = useMemo(() => {
    const { submissionDeposit, preimageRate } = filingCosts
    if (submissionDeposit == null || !preimageRate) return null
    if (mode === "new" && (!preview || preview.error)) return null
    return filingRequirement({
      submissionDeposit: mode === "new" ? submissionDeposit : 0n,
      rate: preimageRate,
      callLen: mode === "new" && preview && !preview.inline && !callAlreadyNoted ? preview.len : null,
      envelopeLen: draft
        ? envelopeBytes(draft.remark_payload)
        : estimateEnvelopeBytes(env.NEXT_PUBLIC_APP_URL, chain.id, proposalId),
      feeAllowance: filingCosts.feeAllowance,
      existentialDeposit: filingCosts.existentialDeposit,
    })
  }, [filingCosts, mode, preview, callAlreadyNoted, draft, chain.id, proposalId])
  const decisionTrack =
    mode === "new" && resolvedOrigin
      ? findTrackByName(tracksQuery.data ?? [], resolvedOrigin.track)
      : null
  const balanceError =
    filingNeeds && balanceQuery.data != null && balanceQuery.data < filingNeeds.total
      ? `Need at least ${formatTokenAmount(filingNeeds.total, chain)} free to cover the deposits, fees and the minimum balance (you have ${formatTokenAmount(balanceQuery.data, chain)}).`
      : null
  const filingCostsCard = filingNeeds && (
    <FilingCosts
      requirement={filingNeeds}
      chain={chain}
      balanceFree={balanceQuery.data ?? null}
      decisionDeposit={decisionTrack?.decisionDeposit ?? null}
      trackLabel={resolvedOrigin ? formatTrackName(resolvedOrigin.label) : null}
      submits={mode === "new"}
    />
  )

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
        (resolvedOrigin != null
          ? null
          : kind === "treasurySpend" && !tierTable
            ? (treasuryTiers.notice ?? "Loading the treasury spend limits…")
            : "No valid submission origin for this amount.") ??
        preview?.error ??
        (preview ? null : "Connecting to the chain…"))
  // Existing referenda by hash: wait until the call is decoded, or the
  // record would say "unknown.unknown".
  const existingCallLoading = mode === "existing" && existingRef != null && existingPreimage.isPending
  const canReview =
    isConnected &&
    !detailsError &&
    !callError &&
    !balanceError &&
    callMeta != null &&
    !staging &&
    !preparing &&
    !existingCallLoading

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
          // Same encoding as the treasury wizard, so the draft shows up in the
          // drafts panel (which matches addresses exactly).
          proposer_address: ownAddress ?? activeAddress,
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
      setStagedFor({ network: chain.id, proposer: ownAddress ?? activeAddress })
      setStep("review")
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (e) {
      toast.error("Could not save the proposal details", { description: formatError(e) })
    } finally {
      setStaging(false)
    }
  }, [
    activeAddress,
    ownAddress,
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
  const skipNoteRef = useRef(false)
  useEffect(() => {
    skipNoteRef.current = callAlreadyNoted
  }, [callAlreadyNoted])
  // And whether the envelope is already noted (by anyone): skip its note.
  const envelopeNoted = useEnvelopeNoted(draft?.remark_payload)
  // What the in-flight batch was built from (see BuiltSubmission).
  const builtRef = useRef<BuiltSubmission | null>(null)

  // Link the draft to its referendum on this site: once the batch
  // finalises, or when a retry finds that an earlier attempt had landed
  // (`landedIn` null: no tx coordinates then).
  const linkReferendum = useCallback(
    async (
      draftId: string,
      index: number,
      landedIn: { txHash: string; blockHash: string } | null,
    ) => {
      setLinkState({ kind: "linking" })
      let blockNumber: number | null = null
      if (landedIn) {
        try {
          const api = apiQuery.data as ApiPromise | undefined
          const header = api ? await api.rpc.chain.getHeader(landedIn.blockHash) : null
          blockNumber = header
            ? (header as unknown as { number: { toNumber(): number } }).number.toNumber()
            : null
        } catch {
          // best-effort
        }
      }
      const error = await confirmWithRetry(
        draftId,
        {
          referendum_index: index,
          tx_hash: landedIn?.txHash ?? null,
          block_hash: landedIn?.blockHash ?? null,
          block_number: blockNumber,
        },
        () => ensureSignedIn({ fresh: true }),
      ).catch((e) => formatError(e))
      setLinkState(error ? { kind: "failed", message: error } : { kind: "linked" })
      // The proposal page and the drafts lists read the row this just linked.
      void queryClient.invalidateQueries({ queryKey: ["proposal-metadata"] })
      void queryClient.invalidateQueries({ queryKey: ["my-drafts"] })
    },
    [apiQuery.data, ensureSignedIn, queryClient],
  )

  const tx = useExtrinsic({
    // The referendum index is written to our DB on success, so wait for
    // finality (a reorg could otherwise pin the wrong index).
    resolveOn: "finalized",
    build: (api) => {
      if (!draft || !stagedFor) throw new Error("Review the proposal before submitting.")
      const moved = stagedForMismatch(stagedFor, {
        network: getActiveChain().id,
        address: activeAddress,
      })
      if (moved) throw new Error(moved)
      if (mode === "existing") {
        const { calls } = attachMetadataToExisting(api, {
          remarkPayload: draft.remark_payload,
          referendumIndex: existingIndex,
          skipEnvelopeNote: envelopeNoted.skipRef.current,
        })
        builtRef.current = { mode, draft, referendumIndex: existingIndex }
        return calls
      }
      if (!spec || !resolvedOrigin) throw new Error("Complete the proposal fields.")
      const referendumIndex = referendumIndexRef.current
      if (referendumIndex == null) {
        throw new Error("Couldn't read the next referendum index - try again in a moment.")
      }
      const { calls } = buildProposalBatch(api, {
        callBytes: buildProposalCall(api, spec).toU8a(),
        origin: resolvedOrigin.origin,
        enactment: resolveEnactment(enactment),
        remarkPayload: draft.remark_payload,
        referendumIndex,
        skipNote: skipNoteRef.current,
        skipEnvelopeNote: envelopeNoted.skipRef.current,
      })
      builtRef.current = { mode, draft, referendumIndex }
      return calls
    },
    async onSuccess({ events, txHash, blockHash }) {
      const built = builtRef.current
      builtRef.current = null
      if (!built) return
      const index =
        built.mode === "existing" ? built.referendumIndex : extractReferendumIndex([...events])
      if (index == null) {
        setIndexLost(true)
        return
      }
      setSubmittedIndex(index)
      if (built.referendumIndex !== index) {
        setLinkState({ kind: "misbound", earlierIndex: built.referendumIndex })
        return
      }
      await linkReferendum(built.draft.id, index, { txHash, blockHash })
    },
    onStatus(status) {
      // One of the two preimages is already on chain: re-read both so the
      // next attempt skips exactly that note.
      if (status.kind === "error" && /AlreadyNoted/i.test(status.message)) {
        void preimageStatusQuery.refetch().then((r) => {
          if (r.isSuccess) skipNoteRef.current = noteWouldAbort(r.data)
        })
        void envelopeNoted.refresh()
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
    setPrecheckError(null)
    if (mode === "new") {
      // Read fresh what the batch depends on. A failed status read keeps the
      // last answer; a failed count read leaves no index, so the build
      // refuses rather than bind the details to a guessed one.
      const status = await preimageStatusQuery.refetch()
      if (status.isSuccess) skipNoteRef.current = noteWouldAbort(status.data)
      const count = await referendumCountQuery.refetch()
      referendumIndexRef.current = count.isSuccess ? count.data : null
      const envelope = await envelopeNoted.refresh()
      // The envelope already on chain may be an earlier attempt of this
      // very batch that landed while its status updates were lost (the
      // lost-contact timeout). Signing again would file a second
      // referendum, so link the one it filed instead. The build refuses a
      // switched account or network, so this only runs for the staged one.
      const api = apiQuery.data as ApiPromise | undefined
      const referendumCount = referendumIndexRef.current
      if (
        envelope !== "Missing" &&
        api &&
        draft &&
        stagedFor &&
        envelopeNoted.hash &&
        referendumCount != null &&
        !stagedForMismatch(stagedFor, { network: getActiveChain().id, address: activeAddress })
      ) {
        let landed: number | null
        try {
          landed = await findLandedSubmission(chainSubmissionReader(api), {
            envelopeHash: envelopeNoted.hash,
            proposer: stagedFor.proposer,
            referendumCount,
          })
        } catch (e) {
          const message = `Couldn't check whether an earlier attempt already filed this proposal, so nothing was signed. Try again in a moment. (${formatError(e)})`
          setPrecheckError(message)
          sign.open()
          if (!sign.isWalletConnect) {
            toast.error("Submission failed", { id: "adv-tx", description: message })
          }
          return
        }
        if (landed != null) {
          sign.close()
          setStep("submit")
          setRecovered(true)
          setSubmittedIndex(landed)
          await linkReferendum(draft.id, landed, null)
          return
        }
      }
    }
    // "existing" signs straight from the tap (no network wait, so mobile
    // wallets still open by themselves); it uses the envelope status read
    // on load, and an AlreadyNoted error re-reads it for the retry.
    setStep("submit")
    sign.open()
    void tx.submit()
  }, [
    isConnected,
    mode,
    preimageStatusQuery,
    referendumCountQuery,
    envelopeNoted,
    apiQuery.data,
    draft,
    stagedFor,
    activeAddress,
    linkReferendum,
    sign,
    tx,
  ])
  // What the sign dialog shows: a refused pre-sign check reads as a failed attempt.
  const signStatus: TxStatus = precheckError
    ? { kind: "error", message: precheckError }
    : tx.status

  const meta = PROPOSAL_KIND_META[kind]
  const readOnly = !isConnected || step !== "create"

  // Hash the exact wasm the upgrade will apply. The chain checks
  // applyAuthorizedUpgrade's code against this blake2-256, byte for byte.
  const onWasmFile = async (file: File | undefined) => {
    if (!file) return
    setHashingWasm(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.length === 0) throw new Error("The file is empty.")
      setField("codeHash", hashCall(bytes))
      setWasmFile({ name: file.name, size: bytes.length })
    } catch (e) {
      toast.error("Could not read the wasm file", { description: formatError(e) })
    } finally {
      setHashingWasm(false)
    }
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

          {/* The form stays locked until then: nothing here is saved, and a
              mobile wallet can reload the page while connecting. */}
          {step === "create" && !isConnected && (
            <div className="rounded-2xl bg-amber-500/5 border border-amber-500/30 p-4 mb-6 flex items-start gap-3">
              <Wallet className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Connect a wallet to continue</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  You sign with your connected wallet. The form unlocks once it&apos;s connected.
                </p>
                <button
                  type="button"
                  onClick={() => setWalletOpen(true)}
                  className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-purple-dim transition-colors"
                >
                  Connect wallet
                </button>
              </div>
            </div>
          )}

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

              <Section title={kind === "authorizeUpgrade" ? "Runtime code" : "Call"}>
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
                {kind === "authorizeUpgrade" && (
                  <>
                    <TextInput
                      label="Code hash (blake2-256 of the runtime wasm)"
                      value={fields.codeHash}
                      onChange={(v) => {
                        setField("codeHash", v)
                        setWasmFile(null)
                      }}
                      placeholder="0x…"
                      mono
                      disabled={readOnly}
                    />
                    <label
                      className={cn(
                        "flex items-center gap-3 rounded-xl border-2 border-dashed border-purple-border bg-primary/5 px-4 py-3",
                        readOnly || hashingWasm
                          ? "opacity-60"
                          : "cursor-pointer hover:bg-primary/10",
                      )}
                    >
                      {hashingWasm ? (
                        <Loader2 className="w-5 h-5 text-primary flex-shrink-0 animate-spin" />
                      ) : wasmFile ? (
                        <FileCode2 className="w-5 h-5 text-primary flex-shrink-0" />
                      ) : (
                        <Upload className="w-5 h-5 text-primary flex-shrink-0" />
                      )}
                      <span className="min-w-0">
                        <span className="block font-mono text-xs text-foreground truncate">
                          {wasmFile?.name ?? "Compute it from the runtime .wasm file"}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {wasmFile
                            ? `${wasmFile.size.toLocaleString("en-US")} bytes · hashed in your browser, never uploaded`
                            : "e.g. enjin_runtime.compact.compressed.wasm"}
                        </span>
                      </span>
                      <input
                        type="file"
                        accept=".wasm,application/wasm"
                        hidden
                        disabled={readOnly || hashingWasm}
                        onChange={(e) => {
                          void onWasmFile(e.target.files?.[0])
                          e.currentTarget.value = ""
                        }}
                      />
                    </label>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Hash the exact file you will apply - normally srtool&apos;s{" "}
                      <span className="font-mono">compact.compressed.wasm</span>. Once the
                      referendum enacts, anyone submits{" "}
                      <span className="font-mono">system.applyAuthorizedUpgrade</span> with that
                      file; any other bytes are rejected. A spec name change or a version that
                      doesn&apos;t increase voids the authorization.
                    </p>
                  </>
                )}
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
                  <>
                    <p className="text-xs text-muted-foreground">
                      Derived from the amount and this runtime&apos;s spend limits:{" "}
                      <span className="text-primary font-mono">{resolvedOrigin?.label ?? "-"}</span>
                    </p>
                    {treasuryTiers.notice && (
                      <p className="text-[11px] text-amber-300 leading-relaxed">
                        {treasuryTiers.notice}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <select
                      value={originIdx}
                      disabled={readOnly}
                      onChange={(e) => setOriginIdx(Number(e.target.value))}
                      aria-label="Submission origin (track)"
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
              {isConnected && filingCostsCard && <div className="mb-4">{filingCostsCard}</div>}
              {isConnected && (detailsError || callError || balanceError) && (
                <p className="text-[11px] text-muted-foreground mb-2">
                  {callError ?? detailsError ?? balanceError}
                </p>
              )}
              <button
                type="button"
                onClick={() => (isConnected ? void guarded(stage) : setWalletOpen(true))}
                disabled={isConnected && !canReview}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(staging || preparing) && <Loader2 className="w-4 h-4 animate-spin" />}
                {isConnected ? "Review" : "Connect wallet"}
                {isConnected && !staging && !preparing && <ArrowRight className="w-4 h-4" />}
              </button>
              <button
                type="button"
                // The draft (if any) is kept: staging again updates it in place.
                onClick={() => setMode(mode === "new" ? "existing" : "new")}
                disabled={preparing}
                className="w-full mt-4 text-xs text-primary hover:text-purple-dim disabled:opacity-50"
              >
                {mode === "new" ? (
                  <>
                    <span className="block text-muted-foreground">Already submitted elsewhere?</span>
                    <span className="block mt-0.5">Add details to an existing referendum →</span>
                  </>
                ) : (
                  "← File a new proposal instead"
                )}
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

              {filingCostsCard && <div className="mb-4">{filingCostsCard}</div>}

              {submittedIndex != null ? (
                <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/30 p-5 space-y-3">
                  <p className="text-sm font-semibold text-foreground">
                    {mode === "new"
                      ? `Referendum #${submittedIndex} submitted`
                      : `Details added to referendum #${submittedIndex}`}
                  </p>
                  {recovered && (
                    <p className="text-xs text-muted-foreground">
                      An earlier attempt had already filed it, so nothing was signed again.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {linkState.kind === "linking" && "Linking the details on this site…"}
                    {linkState.kind === "linked" &&
                      "Its title and description now show on the proposal page."}
                    {linkState.kind === "failed" &&
                      `On chain, but linking on this site failed: ${linkState.message} You can link it later from your drafts.`}
                    {linkState.kind === "misbound" &&
                      `On chain, but its details were bound to your earlier referendum #${linkState.earlierIndex} instead - another submission from this account landed first. To give #${submittedIndex} its own, reload this page and use “Add details to an existing referendum”.`}
                  </p>
                  {mode === "new" && kind === "authorizeUpgrade" && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Once it enacts, apply the upgrade by submitting{" "}
                      <span className="font-mono">system.applyAuthorizedUpgrade</span> with the
                      same wasm file, from any account.
                    </p>
                  )}
                  {/* Not while linking: the proposal page would cache the
                      details as missing. */}
                  {linkState.kind !== "linking" && (
                    <Link
                      href={`/proposals/${submittedIndex}?network=${chain.id}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:text-purple-dim"
                    >
                      View the proposal <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                  {mode === "new" && (
                    <PlaceDepositButton
                      referendumIndex={submittedIndex}
                      trackName={resolvedOrigin?.label ?? null}
                      chain={chain}
                    />
                  )}
                </div>
              ) : indexLost ? (
                <p className="rounded-2xl bg-amber-500/5 border border-amber-500/30 p-5 text-xs text-muted-foreground leading-relaxed">
                  The transaction finalized, but its referendum number couldn&apos;t be read from
                  its events, so the details weren&apos;t linked. Find it in the proposals list,
                  then link it from your drafts - signing again would file a duplicate.
                </p>
              ) : (
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("create")}
                    disabled={tx.isSubmitting || preparing}
                    className="px-4 py-3 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-surface-1 disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void guarded(submit)}
                    disabled={tx.isSubmitting || preparing || !!balanceError}
                    title={balanceError ?? undefined}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all disabled:opacity-50"
                  >
                    {(tx.isSubmitting || preparing) && <Loader2 className="w-4 h-4 animate-spin" />}
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
        status={signStatus}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "in-block" || tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle="Proposal submitted on chain"
        successBody="Your referendum is live. Place its decision deposit to start deciding."
        // Success waits for finality (the default): that's when onSuccess
        // links the details, and a Done at in-block invited leaving first,
        // before the link ever runs.
        onClose={sign.close}
        // The form is locked from Review on, so a retry re-reads the chain,
        // links the referendum if the last attempt landed after all, and
        // otherwise resends the same call and draft.
        onRetry={() => {
          tx.reset()
          setPrecheckError(null)
          void guarded(submit)
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

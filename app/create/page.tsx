"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, Coins } from "lucide-react"
import { toast } from "sonner"
import type { ApiPromise } from "@polkadot/api"
import { stringToU8a } from "@polkadot/util"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { type CallStatus } from "@/components/create/call-card"
import { type UploadedAttachment } from "@/components/create/attachment-dropzone"
import { AddressFormatDialog } from "@/components/create/address-format-dialog"
import { Compose } from "@/components/create/compose"
import { Stage } from "@/components/create/stage"
import { SignAndDone } from "@/components/create/sign-and-done"
import { PlaceDepositButton } from "@/components/governance/place-deposit-button"
import { WizardFooter } from "@/components/create/wizard-footer"
import {
  StepBar,
  type DraftResponse,
  type WizardStep,
} from "@/components/create/create-ui"
import { subscanExtrinsicUrl, subscanReferendumUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { formatTokenAmount, parseTokenAmount } from "@/lib/chain/format"
import {
  encodeForChain,
  inspectAddress,
  isValidAddressForChain,
  samePublicKey,
} from "@/lib/chain/ss58"
import { extractReferendumIndex } from "@/lib/governance/referenda"
import { hashCall, noteWouldAbort } from "@/lib/governance/preimage"
import { formatTrackName } from "@/lib/governance/display"
import { maxTreasurySpend, pickOriginForAmount } from "@/lib/governance/treasury"
import {
  buildTreasuryProposal,
  previewPreimage,
} from "@/lib/governance/submit-treasury-proposal"
import { useApi } from "@/lib/query/hooks/use-api"
import { useBalance } from "@/lib/query/hooks/use-balance"
import { useEnsureSignedIn } from "@/lib/wallet/use-ensure-signed-in"
import { useTracks } from "@/lib/query/hooks/use-tracks"
import { useTreasuryTiers } from "@/lib/query/hooks/use-treasury-tiers"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import { useEnvelopeNoted, usePreimageStatus } from "@/lib/query/hooks/use-preimage"
import { useReferendumCount } from "@/lib/query/hooks/use-referenda"
import { findTrackByName } from "@/lib/governance/tracks"
import {
  DEFAULT_ENACTMENT,
  enactmentLabel,
  resolveEnactment,
  validateEnactment,
  type EnactmentChoice,
} from "@/lib/governance/enactment"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useWallet } from "@/lib/wallet/use-wallet"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
import { formatError } from "@/lib/utils/format-error"
import { confirmWithRetry } from "@/lib/governance/confirm-client"
import { keyFromPublicUrl } from "@/lib/r2/paths"

export default function CreatePage() {
  // useSearchParams() forces this subtree to opt out of static
  // prerendering. Wrapping in Suspense satisfies Next's CSR-bailout
  // requirement while keeping the rest of the chunk eligible. The fallback
  // is what the prerendered HTML shows until the scripts have run: the
  // page's frame and heading instead of a blank page.
  return (
    <Suspense fallback={<CreatePageFallback />}>
      <CreatePageInner />
    </Suspense>
  )
}

function CreatePageFallback() {
  return (
    <Shell>
      <div className="max-w-3xl mx-auto">
        <BackToProposals />
        {/* No network name yet: the saved choice is only read in the browser. */}
        <Header chainName={null} chainShort={null} />
        <StepBar current="create" />
      </div>
    </Shell>
  )
}

function BackToProposals() {
  return (
    <Link
      href="/proposals"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Back to Proposals
    </Link>
  )
}

function CreatePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromDraftId = searchParams.get("from")
  const autoAdvance = searchParams.get("go") === "review"
  const chain = useActiveChain()
  const apiQuery = useApi()
  const tracksQuery = useTracks()
  const treasuryTiers = useTreasuryTiers()
  const treasuryBalanceQuery = useBalance(chain.treasuryAddress)
  const currentBlockQuery = useCurrentBlock()

  const [enactment, setEnactment] = useState<EnactmentChoice>(DEFAULT_ENACTMENT)
  const [step, setStep] = useState<WizardStep>("create")
  // Each draft we stage gets its own UUID. When the user lands here via
  // "Edit" on an existing draft we still mint a fresh id - the prior R2
  // blob stays addressable at its old URL, and the new submission gets a
  // clean DB row + remark.
  const [proposalId, setProposalId] = useState(() => crypto.randomUUID())
  // Resuming an unsigned draft re-stages it in place: the server needs the
  // json_sha256 we last saw to accept the update.
  const [resumedSha, setResumedSha] = useState<string | null>(null)
  // Payload of the last successful stage - staging again with nothing
  // changed just returns to Review instead of rewriting the draft.
  const [stagedFingerprint, setStagedFingerprint] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [body, setBody] = useState("")
  const [amount, setAmount] = useState("")
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  // Track whether we've already populated the form from an existing draft -
  // prevents the load effect from clobbering the user's edits if it re-runs.
  const [prefilled, setPrefilled] = useState(false)
  // Only a draft that actually loaded may be auto-staged (?go=review).
  const [prefillOk, setPrefillOk] = useState(false)
  // Who wrote the proposal loaded via ?from=, and its saved payout address.
  const [loaded, setLoaded] = useState<{ proposer: string; beneficiary: string | null } | null>(
    null,
  )

  const [walletOpen, setWalletOpen] = useState(false)
  const [draft, setDraft] = useState<DraftResponse | null>(null)
  const [staging, setStaging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submittedIndex, setSubmittedIndex] = useState<number | null>(null)
  const [callStatus, setCallStatus] = useState<CallStatus[]>([
    "pending",
    "pending",
    "pending",
    "pending",
  ])

  const { status: walletStatus, activeAddress, session } = useWallet()
  const isConnected = walletStatus === "connected" && !!activeAddress
  const balanceQuery = useBalance(activeAddress)
  const sign = useSignFlow()
  const walletMeta = walletDisplayFor(session ?? null)

  // The draft + media write endpoints now require an authenticated
  // proposer. Mirror the comments flow: prefetch a nonce, and gate the
  // first write behind a sign-in (a one-line nonce signature, no tx).
  const { ensureSignedIn, signInModal } = useEnsureSignedIn({
    isWalletConnect: sign.isWalletConnect,
  })

  // The proposer is always the connected signer (drafts, deposits, sign-in
  // are keyed to it). The beneficiary is who the treasury pays - defaults to
  // the proposer's own wallet, but can be any valid address (gap #3).
  const proposerAddress = useMemo(() => {
    if (!activeAddress) return null
    try {
      return encodeForChain(activeAddress, chain.id)
    } catch {
      return activeAddress
    }
  }, [activeAddress, chain.id])
  const [beneficiaryInput, setBeneficiaryInput] = useState("")
  // What was typed is never converted silently: an address in another
  // network's format opens AddressFormatDialog, and the field only counts
  // once it holds an address in this chain's own format.
  const beneficiaryInspection = useMemo(
    () => inspectAddress(beneficiaryInput, chain.id),
    [beneficiaryInput, chain.id],
  )
  const beneficiary =
    beneficiaryInspection.status === "empty"
      ? proposerAddress // empty = pay self
      : beneficiaryInspection.status === "native"
        ? beneficiaryInspection.address
        : null
  const beneficiaryValid =
    beneficiary != null && isValidAddressForChain(beneficiary, chain.id)
  const beneficiaryIsSelf =
    beneficiary != null && beneficiary === proposerAddress
  const activeAccountName =
    session?.accounts.find((a) => a.address === activeAddress)?.name ?? null

  useEffect(() => {
    if (!isConnected && step !== "create") setStep("create")
  }, [isConnected, step])

  // Load an existing draft into the form when arriving via Edit/Submit.
  // We fetch the canonical JSON (proxied through /api/proposals/[id]/json
  // so CORS doesn't bite) and pre-fill the fields. An unsigned draft keeps
  // its id, beneficiary and attachments, so staging it again updates the
  // same draft instead of creating a duplicate.
  useEffect(() => {
    if (!fromDraftId || prefilled) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/proposals/${fromDraftId}/json`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const j = (await res.json()) as {
          title?: string
          summary?: string | null
          body_markdown?: string
          proposer?: string
          spend?: { amount_planck?: string; beneficiary?: string } | null
          call?: unknown
          attachments?: {
            name: string
            url: string
            sha256: string
            content_type: string
            size_bytes: number
          }[]
        }
        if (cancelled) return
        // A draft from the advanced composer describes a call this wizard
        // can't edit; re-staging it here would turn it into a treasury spend.
        if (j.call) {
          toast.error("This draft was made in the advanced composer", {
            description: "Cancel it from your drafts, or file it again from the advanced composer.",
          })
          setPrefilled(true)
          return
        }
        const resumable = res.headers.get("x-proposal-status") === "draft"
        const sha = res.headers.get("x-proposal-sha256")
        if (resumable && sha) {
          setProposalId(fromDraftId)
          setResumedSha(sha)
          setAttachments(
            (j.attachments ?? []).map((a) => ({
              bucket_key: keyFromPublicUrl(a.url),
              url: a.url,
              sha256: a.sha256,
              size_bytes: a.size_bytes,
              content_type: a.content_type,
              name: a.name,
            })),
          )
        }
        const savedBeneficiary = j.spend?.beneficiary
        setLoaded({
          proposer: j.proposer ?? "",
          beneficiary:
            savedBeneficiary && savedBeneficiary !== j.proposer ? savedBeneficiary : null,
        })
        setTitle(j.title ?? "")
        setSummary(j.summary ?? "")
        setBody(j.body_markdown ?? "")
        if (j.spend?.amount_planck) {
          try {
            const planck = BigInt(j.spend.amount_planck)
            const whole = planck / 10n ** BigInt(chain.decimals)
            const frac = planck % 10n ** BigInt(chain.decimals)
            const fracStr = frac
              .toString()
              .padStart(chain.decimals, "0")
              .replace(/0+$/, "")
            setAmount(fracStr ? `${whole}.${fracStr}` : whole.toString())
          } catch {
            // ignore - user can re-enter.
          }
        }
        setPrefilled(true)
        setPrefillOk(true)
        toast.success("Loaded draft", {
          description: resumable
            ? "Edit anything, then stage to update this draft."
            : "Edit anything, then stage to save it as a new draft.",
        })
      } catch (e) {
        toast.error("Could not load draft", { description: formatError(e) })
        setPrefilled(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chain.decimals, fromDraftId, prefilled])

  // parsed amount + tier
  let parsedAmount: bigint | null = null
  let amountError: string | null = null
  try {
    if (amount) parsedAmount = parseTokenAmount(amount, chain)
  } catch (e) {
    amountError = e instanceof Error ? e.message : "Invalid amount"
  }
  // Spend limits for the connected runtime - null while connecting, or when
  // the runtime predates every listed spec (then nothing can be filed).
  const tiers = treasuryTiers.table?.tiers ?? null
  const pickedTier =
    parsedAmount != null && tiers ? pickOriginForAmount(parsedAmount, tiers) : null
  // A positive amount with no covering tier means it exceeds the top tier's
  // (TreasuryAdmin) cap - there is no unbounded fallback, so we block
  // submission rather than file a referendum that can't enact.
  const amountExceedsMaxTier =
    parsedAmount != null && parsedAmount > 0n && !amountError && tiers != null && pickedTier == null

  // Non-blocking notes under the amount field. spend_local doesn't check the
  // treasury balance: an approved spend the treasury can't cover waits until
  // it can.
  const amountWarnings: string[] = []
  if (treasuryTiers.table && treasuryTiers.notice) {
    amountWarnings.push(treasuryTiers.notice)
  }
  if (
    parsedAmount != null &&
    treasuryBalanceQuery.data != null &&
    parsedAmount > treasuryBalanceQuery.data
  ) {
    amountWarnings.push(
      `The treasury holds ${formatTokenAmount(treasuryBalanceQuery.data, chain)} right now. If approved, this spend is paid only once the treasury can cover it in full.`,
    )
  }

  // Track-level deposits for the picked origin (read from chain consts).
  const trackForOrigin = useMemo(() => {
    if (!tracksQuery.data || !pickedTier) return null
    return findTrackByName(tracksQuery.data, pickedTier.origin)
  }, [tracksQuery.data, pickedTier])

  // Submission deposit from referenda pallet consts (always-on small
  // amount that gets reserved on submit and refunded once decided).
  const submissionDeposit = useMemo<bigint | null>(() => {
    const api = apiQuery.data as ApiPromise | undefined
    if (!api?.consts?.referenda?.submissionDeposit) return null
    try {
      const codec = api.consts.referenda.submissionDeposit as unknown as {
        toString(): string
      }
      return BigInt(codec.toString())
    } catch {
      return null
    }
  }, [apiQuery.data])

  // Anti-spam balance gate. The proposer must hold the submission
  // deposit (reserved immediately) + the track's decision deposit
  // (anyone can place it later, but requiring the proposer to be able
  // to cover it themselves screens out spam) + a small fee buffer.
  const FEE_BUFFER_PLANCK = 10n ** BigInt(chain.decimals - 2) // 0.01 of one token
  const requiredPlanck: bigint | null =
    submissionDeposit != null && trackForOrigin
      ? submissionDeposit + trackForOrigin.decisionDeposit + FEE_BUFFER_PLANCK
      : null
  const balanceSufficient =
    requiredPlanck == null ||
    balanceQuery.data == null ||
    balanceQuery.data >= requiredPlanck

  // preimage preview (computed locally, no network)
  const preimagePreview = useMemo(() => {
    const api = apiQuery.data as ApiPromise | undefined
    if (!api || parsedAmount == null || !beneficiary || !beneficiaryValid) {
      return null
    }
    try {
      return previewPreimage(api, { amount: parsedAmount, beneficiary })
    } catch {
      return null
    }
  }, [apiQuery.data, beneficiary, beneficiaryValid, parsedAmount])

  // blake2-256 of the EGOV1 envelope bytes - the hash setMetadata binds to
  // the referendum. Distinct from the sha256 inside the envelope, which
  // commits to the off-chain JSON.
  const metadataHash = useMemo(() => {
    if (!draft) return null
    try {
      return hashCall(stringToU8a(draft.remark_payload))
    } catch {
      return null
    }
  }, [draft])

  // If an account already noted these exact call bytes (Unrequested),
  // `preimage.notePreimage` would abort with AlreadyNoted and revert
  // the whole batchAll. The hash + len are the same regardless, so we
  // can skip step 1 and only sign submit + remark. A Requested preimage
  // still takes the note (see noteWouldAbort).
  const preimageStatusQuery = usePreimageStatus(preimagePreview?.preimageHash ?? null)
  const preimageAlreadyNoted = noteWouldAbort(preimageStatusQuery.data)

  // Authoritative "should we skip notePreimage?" decision used by the build
  // closure at submit time. The status query is 30s-stale: if it read
  // "Missing" but the preimage gets noted before we sign, notePreimage aborts
  // with `preimage.AlreadyNoted` and reverts the whole batchAll - and a naive
  // retry rebuilds the identical failing batch (a UX dead-end until the cache
  // expires). We seed this ref from the cached status, but also (a) refetch
  // the status right before submitting and (b) force it true if a dispatch
  // error comes back as AlreadyNoted, so the next attempt drops step 1 and
  // submits [submit, remark] against the same (hash, len). A ref (not state)
  // avoids a render round-trip so the synchronous build closure sees the
  // freshest decision immediately after an imperative refetch.
  const skipNoteRef = useRef(false)
  useEffect(() => {
    skipNoteRef.current = preimageAlreadyNoted
  }, [preimageAlreadyNoted])
  // The same for the EGOV1 envelope's own preimage (step 3).
  const envelopeNoted = useEnvelopeNoted(draft?.remark_payload)

  // The referendum index setMetadata targets = referendumCount() at the
  // moment referenda.submit executes. Same seed-a-ref shape as skipNoteRef:
  // the query keeps a recent value warm, and submitProposal refetches
  // imperatively right before signing so the synchronous build closure sees
  // the freshest count. If another submission still lands between the read
  // and inclusion, setMetadata fails the depositor check (NoPermission) and
  // the whole batchAll reverts - retry rebuilds with a fresh count.
  const referendumCountQuery = useReferendumCount()
  const referendumIndexRef = useRef<number | null>(null)
  useEffect(() => {
    if (referendumCountQuery.data != null) {
      referendumIndexRef.current = referendumCountQuery.data
    }
  }, [referendumCountQuery.data])

  // Validate the chosen enactment moment against the live head + the picked
  // track's minEnactmentPeriod (gap #2). Standard/After are always fine; an
  // At-block height must be in the future and past the track's floor.
  const enactmentError = validateEnactment(enactment, {
    currentBlock: currentBlockQuery.data ?? null,
    minEnactment: trackForOrigin?.minEnactmentPeriod ?? null,
  })

  const composeValid =
    isConnected &&
    beneficiaryValid &&
    title.trim().length >= 10 &&
    summary.trim().length >= 20 &&
    body.trim().length >= 50 &&
    parsedAmount != null &&
    parsedAmount > 0n &&
    !amountError &&
    pickedTier != null &&
    !enactmentError &&
    balanceSufficient

  // Human-readable list of every unmet requirement, surfaced under the
  // Stage button so the user doesn't have to hunt for the field that's
  // blocking them. Order roughly follows the form layout top to bottom.
  const missingReasons: string[] = []
  if (!isConnected) {
    missingReasons.push("Connect your wallet")
  }
  if (isConnected && !beneficiaryValid) {
    missingReasons.push(
      beneficiaryInspection.status === "foreign"
        ? `Beneficiary is a ${beneficiaryInspection.networkLabel} address. Convert or clear it.`
        : beneficiaryInput.trim()
          ? "Beneficiary address isn't valid on this chain"
          : "Connected address isn't valid on this chain",
    )
  }
  if (title.trim().length < 10) {
    missingReasons.push(
      `Title needs at least 10 characters (currently ${title.trim().length})`,
    )
  }
  if (summary.trim().length < 20) {
    missingReasons.push(
      `Summary needs at least 20 characters (currently ${summary.trim().length})`,
    )
  }
  if (body.trim().length < 50) {
    missingReasons.push(
      `Proposal body needs at least 50 characters (currently ${body.trim().length})`,
    )
  }
  if (amountError) {
    missingReasons.push(`Amount: ${amountError}`)
  } else if (parsedAmount == null) {
    missingReasons.push(`Enter a requested amount in ${chain.ticker}`)
  } else if (parsedAmount <= 0n) {
    missingReasons.push("Requested amount must be greater than zero")
  } else if (treasuryTiers.specVersion == null) {
    missingReasons.push("Waiting for the chain connection to load treasury spend limits")
  } else if (!tiers) {
    missingReasons.push(treasuryTiers.notice ?? "Treasury spend limits are unavailable")
  } else if (amountExceedsMaxTier) {
    const cap = maxTreasurySpend(tiers)
    const capTier = cap != null ? pickOriginForAmount(cap, tiers) : null
    missingReasons.push(
      cap != null && capTier
        ? `Requested amount exceeds the maximum treasury spend of ${formatTokenAmount(cap, chain)} (${formatTrackName(capTier.origin)}). Reduce the amount.`
        : "Requested amount exceeds the maximum treasury spend tier.",
    )
  }
  if (!balanceSufficient && requiredPlanck != null && balanceQuery.data != null) {
    missingReasons.push(
      `Need at least ${formatTokenAmount(requiredPlanck, chain)} to cover the submission deposit, decision deposit, and fees (you have ${formatTokenAmount(balanceQuery.data, chain)})`,
    )
  }
  if (enactmentError) {
    missingReasons.push(`Enactment: ${enactmentError}`)
  }

  // staging hop (upload media is already done; here we upload JSON)
  const stageDraft = useCallback(async () => {
    if (!preimagePreview || !pickedTier || !beneficiary || !parsedAmount) {
      toast.error("Form is incomplete")
      return
    }
    const payload = {
      proposal_id: proposalId,
      network: chain.id,
      proposer_address: proposerAddress,
      title: title.trim(),
      summary: summary.trim() || null,
      body_markdown: body,
      track: pickedTier.origin,
      beneficiary,
      amount_planck: parsedAmount.toString(),
      preimage_hash: preimagePreview.preimageHash,
      preimage_len: preimagePreview.preimageLen,
      attachments: attachments.map((a) => ({
        bucket_key: a.bucket_key,
        name: a.name,
        url: a.url,
        sha256: a.sha256,
        content_type: a.content_type,
        size_bytes: a.size_bytes,
      })),
    }
    // Back -> Stage with nothing changed: the saved draft is still current.
    const fingerprint = JSON.stringify(payload)
    if (draft && fingerprint === stagedFingerprint) {
      setStep("review")
      return
    }
    // The draft endpoint requires an authenticated proposer - sign in
    // first and bail out of staging if that doesn't go through.
    if (!(await ensureSignedIn())) return
    setStaging(true)
    try {
      const res = await fetch("/api/proposals/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          // Re-staging updates the same draft in place; the server only
          // accepts that from the version we last saw.
          expected_sha256: draft?.json_sha256 ?? resumedSha,
        }),
      })
      const json = (await res.json()) as DraftResponse | { ok: false; error: string }
      if (!res.ok || !("ok" in json) || !json.ok) {
        const err = "error" in json ? json.error : `HTTP ${res.status}`
        toast.error("Could not stage Proposal", { description: err })
        setStaging(false)
        return
      }
      const saved = json as DraftResponse
      setDraft(saved)
      setStagedFingerprint(fingerprint)
      if (saved.updated) {
        toast.success("Draft updated", {
          description: "Same draft, new version.",
        })
      }
      setStep("review")
    } catch (e) {
      toast.error("Could not stage Proposal", {
        description: formatError(e),
      })
    } finally {
      setStaging(false)
    }
  }, [
    attachments,
    beneficiary,
    proposerAddress,
    body,
    chain.id,
    draft,
    ensureSignedIn,
    parsedAmount,
    pickedTier,
    preimagePreview,
    proposalId,
    resumedSha,
    stagedFingerprint,
    summary,
    title,
  ])

  // A link to someone else's proposal copies its text, never its payout
  // address, and never skips to signing: the beneficiary and the
  // auto-advance below are only taken from the connected wallet's own.
  const loadedIsMine = useMemo(() => {
    if (!loaded?.proposer || !activeAddress) return false
    try {
      return samePublicKey(loaded.proposer, activeAddress)
    } catch {
      return false
    }
  }, [loaded, activeAddress])
  useEffect(() => {
    const saved = loaded?.beneficiary
    if (loadedIsMine && saved) setBeneficiaryInput((current) => current || saved)
  }, [loadedIsMine, loaded])

  // When arriving via "Submit" on a draft (?go=review), auto-stage once
  // the form has been populated and is valid. The user still has to sign
  // on the Review screen - we just save the click.
  const [autoStaged, setAutoStaged] = useState(false)
  useEffect(() => {
    if (!autoAdvance || autoStaged || !prefilled || !prefillOk || !loadedIsMine) return
    if (!isConnected || !composeValid) return
    if (staging || step !== "create") return
    setAutoStaged(true)
    void stageDraft()
  }, [
    autoAdvance,
    autoStaged,
    prefilled,
    prefillOk,
    loadedIsMine,
    isConnected,
    composeValid,
    staging,
    step,
    stageDraft,
  ])

  const tx = useExtrinsic({
    // We persist the on-chain `referendum_index` from the batch's events
    // into our DB via POST /api/proposals/[id]/confirm. A reorg between
    // inBlock and finality would pin the wrong index, so this is the one
    // flow that must wait for GRANDPA before resolving.
    resolveOn: "finalized",
    build: (api) => {
      if (!draft || !pickedTier || !beneficiary || parsedAmount == null) {
        throw new Error("Review the draft before submitting.")
      }
      // Light every call in the batch as running while the single
      // signed extrinsic is in-flight - the user signs one tx that
      // either applies all or none, so showing per-call pending state
      // during signing/broadcast/in-block is misleading. Per-call
      // status only meaningfully diverges once events come back at
      // finalization (or one fails).
      const referendumIndex = referendumIndexRef.current
      if (referendumIndex == null) {
        throw new Error(
          "Couldn't read the next referendum index - try again in a moment.",
        )
      }
      const skipNote = skipNoteRef.current
      setCallStatus(
        skipNote
          ? ["ok", "running", "running", "running"]
          : ["running", "running", "running", "running"],
      )
      const built = buildTreasuryProposal(api, {
        amount: parsedAmount,
        beneficiary,
        tier: pickedTier,
        remarkPayload: draft.remark_payload,
        referendumIndex,
        enactment: resolveEnactment(enactment),
      })
      // If the preimage is already on chain (e.g. an earlier identical
      // submission noted it), retrying the note step would abort with
      // preimage.AlreadyNoted and revert the whole batchAll. Drop step
      // 1; the rest of the batch still references the same (hash, len).
      // Likewise step 3 when the envelope is already noted.
      return [
        ...(skipNote ? [] : [built.noteTx]),
        built.submitTx,
        ...(envelopeNoted.skipRef.current ? [] : [built.metadataNoteTx]),
        built.setMetadataTx,
      ]
    },
    onStatus(status) {
      if (status.kind === "error") {
        setCallStatus((curr) =>
          curr.map((c) => (c === "running" ? "failed" : c)) as CallStatus[],
        )
        // Self-heal the AlreadyNoted dead-end: one of the two preimages is
        // already on chain. Re-read both, so the next attempt skips exactly
        // the note that is already there instead of guessing.
        if (/AlreadyNoted/i.test(status.message)) {
          void preimageStatusQuery.refetch().then((r) => {
            if (r.isSuccess) skipNoteRef.current = noteWouldAbort(r.data)
          })
          void envelopeNoted.refresh()
        }
      }
      if (sign.isWalletConnect) {
        // SignRequestModal renders the full lifecycle.
        return
      }
      if (status.kind === "signing") {
        toast.dismiss("create-tx")
        toast.loading("Waiting for wallet signature…", {
          id: "create-tx",
          description: "",
        })
      } else if (status.kind === "broadcast") {
        toast.dismiss("create-tx")
        toast.loading("Broadcasting batch…", {
          id: "create-tx",
          description: "",
        })
      } else if (status.kind === "in-block") {
        toast.dismiss("create-tx")
        toast.loading("Included in block - awaiting finalisation", {
          id: "create-tx",
          description: "",
        })
      } else if (status.kind === "error") {
        toast.dismiss("create-tx")
        toast.error("Submission failed", {
          id: "create-tx",
          description: status.message,
        })
      }
    },
    async onSuccess({ events, txHash, blockHash }) {
      setCallStatus(["ok", "ok", "ok", "ok"])
      const index = extractReferendumIndex(events)
      setSubmittedIndex(index)

      // Confirm on the server so the redirect file + DB row are updated.
      // The referendum is already on chain at this point, so a failure here
      // does not lose the proposal - but it does leave the row 'draft' with
      // no narrative attached to a referendum that is live and taking votes,
      // and nothing else in the app re-attaches it. So: retry the retryable
      // failures, and never claim success for one that stuck.
      let confirmError: string | null = null
      if (draft && index != null) {
        setConfirming(true)
        try {
          const api = apiQuery.data as ApiPromise | undefined
          let blockNumber = 0
          if (api) {
            try {
              const header = await api.rpc.chain.getHeader(blockHash)
              blockNumber = (
                header as unknown as { number: { toNumber(): number } }
              ).number.toNumber()
            } catch {
              // best-effort
            }
          }
          confirmError = await confirmWithRetry(
            draft.id,
            {
              referendum_index: index,
              tx_hash: txHash,
              block_hash: blockHash,
              block_number: blockNumber,
            },
            // The session can run out while the batch finalises; sign in
            // again rather than leave a live referendum unlinked.
            () => ensureSignedIn({ fresh: true }),
          )
        } catch (err) {
          confirmError = formatError(err)
        } finally {
          setConfirming(false)
        }
      }

      if (confirmError) {
        // The submission itself succeeded; only the off-chain link failed.
        // Say both, rather than a green toast over a half-finished job.
        toast.warning("Submitted on chain, but not linked", {
          id: "create-tx",
          duration: Infinity,
          description:
            index != null
              ? `Referendum #${index} was created, but attaching its off-chain details failed: ${confirmError}`
              : confirmError,
          action:
            index != null
              ? {
                  label: "View",
                  onClick: () => router.push(`/proposals/${index}`),
                }
              : undefined,
        })
      } else {
        toast.success("Proposal submitted", {
          id: "create-tx",
          description:
            index != null
              ? `Referendum #${index} created.`
              : subscanExtrinsicUrl(chain, txHash),
          action:
            index != null
              ? {
                  label: "View",
                  onClick: () => router.push(`/proposals/${index}`),
                }
              : undefined,
        })
      }
      // Stay on the Submit step - its rendering branches on tx.status.kind
      // and shows the success card automatically on finalised.
    },
  })

  // Refresh the (30s-stale) preimage status and the referendum count right
  // before broadcasting so the build closure sees on-chain reality, then
  // submit. Without the former, an identical preimage noted between page
  // load and signing would trip preimage.AlreadyNoted; without the latter,
  // another submission landing in the meantime would leave setMetadata
  // pointing at someone else's index (NoPermission). Either way the whole
  // batch reverts, so both refreshes are correctness-of-first-try, not
  // safety.
  const submitProposal = useCallback(async () => {
    try {
      // Both ways: a preimage unnoted since the cached read must be noted
      // again, or the Lookup would point at nothing.
      const res = await preimageStatusQuery.refetch()
      if (res.isSuccess) skipNoteRef.current = noteWouldAbort(res.data)
    } catch {
      // Best-effort: fall back to whatever the seeded ref already holds.
    }
    await envelopeNoted.refresh()
    try {
      const count = await referendumCountQuery.refetch()
      if (count.data != null) {
        referendumIndexRef.current = count.data
      }
    } catch {
      // Best-effort: fall back to the seeded ref; build throws if empty.
    }
    void tx.submit()
  }, [preimageStatusQuery, referendumCountQuery, envelopeNoted, tx])

  return (
    <Shell>
      <div className="max-w-3xl mx-auto">
        <BackToProposals />

        <Header chainName={chain.name} chainShort={chain.shortName} />
        <StepBar current={step} />

        {step === "create" && (
          <div className="mb-4 text-xs text-muted-foreground">
            Filing a runtime upgrade, referendum cancel/kill, whitelist, or other
            non-treasury call?{" "}
            <Link
              href="/create/advanced"
              className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-current"
            >
              Use the advanced composer
            </Link>
            .
          </div>
        )}

        {step === "create" && (
          <Compose
            isConnected={isConnected}
            balanceFree={balanceQuery.data ?? null}
            proposerAddress={proposerAddress}
            beneficiary={beneficiary}
            beneficiaryInput={beneficiaryInput}
            beneficiaryStatus={beneficiaryInspection.status}
            beneficiaryNetworkLabel={
              beneficiaryInspection.status === "foreign"
                ? beneficiaryInspection.networkLabel
                : null
            }
            beneficiaryIsSelf={beneficiaryIsSelf}
            accountName={activeAccountName}
            chainShort={chain.shortName}
            chainTicker={chain.ticker}
            chainDecimals={chain.decimals}
            title={title}
            summary={summary}
            body={body}
            amount={amount}
            amountError={amountError}
            amountWarnings={amountWarnings}
            tiers={tiers}
            pickedTier={pickedTier}
            requiredPlanck={requiredPlanck}
            balanceSufficient={balanceSufficient}
            proposalId={proposalId}
            network={chain.id}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            beforeUpload={ensureSignedIn}
            enactment={enactment}
            enactmentError={enactmentError}
            minEnactment={trackForOrigin?.minEnactmentPeriod ?? null}
            onTitle={setTitle}
            onSummary={setSummary}
            onBody={setBody}
            onAmount={setAmount}
            onBeneficiary={setBeneficiaryInput}
            onEnactment={setEnactment}
            onConnect={() => setWalletOpen(true)}
          />
        )}

        {step === "review" && draft && pickedTier && parsedAmount && beneficiary && (
          <Stage
            draft={draft}
            title={title}
            summary={summary}
            body={body}
            amountFormatted={formatTokenAmount(parsedAmount, chain)}
            amountPlanck={parsedAmount}
            beneficiary={beneficiary}
            beneficiaryName={beneficiaryIsSelf ? activeAccountName : null}
            track={formatTrackName(pickedTier.origin)}
            trackRaw={pickedTier.origin}
            chainName={chain.name}
            network={chain.id}
            attachments={attachments}
            callHex={preimagePreview?.callHex ?? "0x"}
            preimageHash={preimagePreview?.preimageHash ?? "0x"}
            preimageLen={preimagePreview?.preimageLen ?? 0}
            preimageAlreadyNoted={preimageAlreadyNoted}
            metadataHash={metadataHash}
            decisionDeposit={trackForOrigin?.decisionDeposit ?? null}
            enactmentText={enactmentLabel(enactment)}
            chainTicker={chain.ticker}
            chainDecimals={chain.decimals}
          />
        )}

        {step === "submit" && draft && pickedTier && parsedAmount && beneficiary && (
          <SignAndDone
            chainName={chain.name}
            subscanTxUrl={(hash) => subscanExtrinsicUrl(chain, hash)}
            calls={[
              {
                title: "Register the proposal content",
                pallet: "preimage",
                method: "notePreimage",
                summary:
                  "Stores the call bytes on chain so the referendum has something to enact when it passes.",
                details: [
                  { label: "Preimage hash", value: preimagePreview?.preimageHash ?? "-" },
                  { label: "Length (bytes)", value: String(preimagePreview?.preimageLen ?? 0) },
                ],
                rawPayload: preimagePreview?.callHex,
              },
              {
                title: `File the referendum on ${formatTrackName(pickedTier.origin)}`,
                pallet: "referenda",
                method: "submit",
                summary: `Opens voting on the ${formatTrackName(pickedTier.origin)} track. Enactment: ${enactmentLabel(enactment)}.`,
                details: [
                  { label: "Origin", value: `Origins.${pickedTier.origin}` },
                  { label: "Lookup hash", value: preimagePreview?.preimageHash ?? "-" },
                  { label: "Lookup len", value: String(preimagePreview?.preimageLen ?? 0) },
                  { label: "Enactment", value: enactmentLabel(enactment) },
                ],
              },
              {
                title: "Register the EGOV1 metadata envelope",
                pallet: "preimage",
                method: "notePreimage",
                summary:
                  "Stores the pointer to the off-chain proposal on chain so anyone can fetch and verify it.",
                details: [
                  { label: "Standard", value: "EGOV1" },
                  { label: "JSON URL", value: draft.json_url },
                  { label: "sha256", value: draft.json_sha256 },
                ],
                rawPayload: draft.remark_payload,
              },
              {
                title: "Bind the metadata to the referendum",
                pallet: "referenda",
                method: "setMetadata",
                summary:
                  "Points the referendum at the envelope so wallets, explorers, and indexers resolve it natively.",
                details: [
                  {
                    label: "Referendum index",
                    value:
                      referendumCountQuery.data != null
                        ? `#${referendumCountQuery.data}`
                        : "next index at signing",
                  },
                  { label: "Metadata hash", value: metadataHash ?? "-" },
                ],
              },
            ]}
            callStatus={callStatus}
            txStatus={tx.status}
            submittedIndex={submittedIndex}
            confirming={confirming}
            referendumLink={
              submittedIndex != null
                ? subscanReferendumUrl(chain, submittedIndex)
                : null
            }
            jsonUrl={draft.json_url}
            decisionDepositSlot={
              submittedIndex != null ? (
                <PlaceDepositButton
                  referendumIndex={submittedIndex}
                  trackName={pickedTier.origin}
                  chain={chain}
                />
              ) : null
            }
          />
        )}

        <WizardFooter
          step={step}
          canStage={composeValid && !staging}
          missingReasons={missingReasons}
          staging={staging}
          tx={tx}
          isConnected={isConnected}
          isWalletConnect={
            session?.connectorId === "enjin-wallet" ||
            session?.connectorId === "walletconnect"
          }
          peerRedirect={(session?.meta?.peerRedirect as string | undefined) ?? null}
          onBack={() => {
            if (step === "review") setStep("create")
            else if (step === "submit") setStep("review")
          }}
          onStage={stageDraft}
          onSign={() => {
            sign.open()
            void submitProposal()
            setStep("submit")
          }}
          onRetry={() => {
            tx.reset()
            setCallStatus(["pending", "pending", "pending", "pending"])
            sign.open()
            setTimeout(() => {
              void submitProposal()
            }, 50)
          }}
          onView={() =>
            submittedIndex != null && router.push(`/proposals/${submittedIndex}`)
          }
        />
      </div>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      {step === "create" && beneficiaryInspection.status === "foreign" && (
        <AddressFormatDialog
          input={beneficiaryInspection.input}
          networkLabel={beneficiaryInspection.networkLabel}
          convertedAddress={beneficiaryInspection.address}
          chainShortName={chain.shortName}
          isOwnWallet={beneficiaryInspection.address === proposerAddress}
          onConvert={() => setBeneficiaryInput(beneficiaryInspection.address)}
          onCancel={() => setBeneficiaryInput("")}
        />
      )}
      <SignRequestModal
        open={sign.isOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Approve the proposal batch in your wallet"
        status={tx.status}
        deepLinkUrl={sign.deepLinkUrl}
        explorerUrl={
          tx.status.kind === "finalized"
            ? subscanExtrinsicUrl(chain, tx.status.txHash)
            : null
        }
        successTitle={
          submittedIndex != null
            ? `Referendum #${submittedIndex} submitted`
            : "Proposal submitted on chain"
        }
        successBody="The referendum is live. You can view it from the footer below."
        onClose={sign.close}
        onRetry={() => {
          tx.reset()
          setCallStatus(["pending", "pending", "pending", "pending"])
          setTimeout(() => {
            void submitProposal()
          }, 50)
        }}
      />
      <SignRequestModal
        {...signInModal}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Sign in to stage your proposal"
        deepLinkUrl={sign.deepLinkUrl}
      />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">{children}</main>
      <Footer />
    </div>
  )
}

function Header({
  chainName,
  chainShort,
}: {
  chainName: string | null
  chainShort: string | null
}) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="w-11 h-11 rounded-xl bg-primary/10 border border-purple-border flex items-center justify-center flex-shrink-0">
        <Coins className="w-5 h-5 text-primary" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">
          Treasury Proposal
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {chainName && chainShort ? (
            <>
              Request a payout from the {chainShort} treasury to your
              connected wallet on{" "}
              <span className="text-foreground">{chainName}</span>.
            </>
          ) : (
            "Request a payout from the treasury to your connected wallet."
          )}
        </p>
      </div>
    </div>
  )
}


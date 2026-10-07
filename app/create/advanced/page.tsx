"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, FileUp, Loader2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import type { ApiPromise } from "@polkadot/api"
import { u8aToHex } from "@polkadot/util"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { PlaceDepositButton } from "@/components/governance/place-deposit-button"
import { EnactmentField } from "@/components/create/enactment-field"
import { Field, type DraftResponse } from "@/components/create/create-ui"
import { cn } from "@/lib/utils"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { parseTokenAmount } from "@/lib/chain/format"
import { encodeForChain, isValidAddressForChain } from "@/lib/chain/ss58"
import {
  buildProposalCall,
  PROPOSAL_KIND_META,
  SUBMIT_ORIGINS,
  type ProposalCallSpec,
  type ProposalKind,
} from "@/lib/governance/proposal-calls"
import { extractReferendumIndex } from "@/lib/governance/referenda"
import { canInline, hashCall } from "@/lib/governance/preimage"
import { buildProposalSubmission } from "@/lib/governance/submit-proposal"
import {
  DEFAULT_ENACTMENT,
  resolveEnactment,
  validateEnactment,
  type EnactmentChoice,
} from "@/lib/governance/enactment"
import { pickOriginForAmount } from "@/lib/governance/treasury"
import { confirmWithRetry } from "@/lib/query/confirm-proposal"
import { useApi } from "@/lib/query/hooks/use-api"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
import { usePreimageStatus } from "@/lib/query/hooks/use-preimage"
import { useReferendumCount } from "@/lib/query/hooks/use-referenda"
import { useMe, useNoncePrefetch, useSignIn } from "@/lib/query/hooks/use-session"
import { useExtrinsic } from "@/lib/query/hooks/use-tx"
import { useWallet } from "@/lib/wallet/use-wallet"
import { useSignFlow } from "@/lib/wallet/use-sign-flow"
import { walletDisplayFor } from "@/lib/wallet/connector-registry"
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

/** Index into SUBMIT_ORIGINS of a kind's suggested origin, or 0 (Root). */
function suggestedOriginIdx(kind: ProposalKind): number {
  const sugg = PROPOSAL_KIND_META[kind].suggestedOrigin
  if (!sugg) return 0
  const i = SUBMIT_ORIGINS.findIndex(
    (o) => JSON.stringify(o.origin) === JSON.stringify(sugg),
  )
  return i >= 0 ? i : 0
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

const isHex = (s: string, exactBytes?: number) => {
  if (!/^0x[0-9a-fA-F]*$/.test(s)) return false
  if (s.length % 2 !== 0) return false
  if (exactBytes != null && s.length !== 2 + exactBytes * 2) return false
  return true
}

export default function AdvancedCreatePage() {
  const chain = useActiveChain()
  const apiQuery = useApi()
  const currentBlockQuery = useCurrentBlock()
  const { status: walletStatus, activeAddress, session } = useWallet()
  const isConnected = walletStatus === "connected" && !!activeAddress
  const walletMeta = walletDisplayFor(session ?? null)
  const sign = useSignFlow()

  const [kind, setKind] = useState<ProposalKind>(DEFAULT_KIND)
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS)
  const [originIdx, setOriginIdx] = useState<number>(() =>
    suggestedOriginIdx(DEFAULT_KIND),
  )
  const [enactment, setEnactment] = useState<EnactmentChoice>(DEFAULT_ENACTMENT)
  const [walletOpen, setWalletOpen] = useState(false)
  const [submittedIndex, setSubmittedIndex] = useState<number | null>(null)
  // The runtime wasm whose hash filled the code-hash field, if one was picked.
  const [wasmFile, setWasmFile] = useState<{ name: string; size: number } | null>(null)
  const [hashingWasm, setHashingWasm] = useState(false)

  // Optional EGOV1 narrative. When attached, it's staged as a draft and bound
  // to the new referendum by referenda.setMetadata in the same batch - the
  // same standard the treasury wizard uses - so the detail page shows it.
  const [attachDetails, setAttachDetails] = useState(true)
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [body, setBody] = useState("")
  const [staging, setStaging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // Drafts + sign-in are keyed to the connected signer, encoded for this chain.
  const proposerAddress = useMemo(() => {
    if (!activeAddress) return null
    try {
      return encodeForChain(activeAddress, chain.id)
    } catch {
      return activeAddress
    }
  }, [activeAddress, chain.id])

  // The draft endpoint requires an authenticated proposer - same nonce
  // sign-in as the treasury wizard (a message signature, no tx).
  const meQuery = useMe()
  const prefetchedNonce = useNoncePrefetch()
  const signIn = useSignIn(prefetchedNonce)
  const [signInModalOpen, setSignInModalOpen] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)

  const setField = (k: keyof Fields, v: string) =>
    setFields((f) => ({ ...f, [k]: v }))

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
          const beneficiary = fields.beneficiary.trim()
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
          if (!isHex(fields.codeHash, 32)) {
            return {
              spec: null,
              fieldError: "Enter the wasm's 32-byte blake2-256 hash (0x…), or pick the .wasm file.",
            }
          }
          return {
            spec: { kind, codeHash: fields.codeHash.toLowerCase() as `0x${string}` },
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

  // Same minimums as the treasury wizard, so every narrative on the detail
  // page meets one bar.
  const detailsError = !attachDetails
    ? null
    : title.trim().length < 10
      ? `Title needs at least 10 characters (currently ${title.trim().length}).`
      : summary.trim().length < 20
        ? `Summary needs at least 20 characters (currently ${summary.trim().length}).`
        : body.trim().length < 50
          ? `Proposal body needs at least 50 characters (currently ${body.trim().length}).`
          : null

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
        len: bytes.length,
        inline: canInline(bytes),
        hex: u8aToHex(bytes),
        callHash: hashCall(bytes),
        error: null as string | null,
      }
    } catch (e) {
      return {
        section: "",
        method: "",
        len: 0,
        inline: false,
        hex: "0x",
        callHash: "0x" as `0x${string}`,
        error: formatError(e),
      }
    }
  }, [apiQuery.data, spec])

  // Hash of call bytes already noted on chain, whose notePreimage must be
  // dropped (it would abort with AlreadyNoted and revert the batch). Keyed by
  // hash rather than a boolean so a decision made for one call can never drop
  // the note of another - a Lookup to an un-noted preimage would still submit,
  // but could never enact.
  const preimageStatusQuery = usePreimageStatus(
    preview && !preview.inline && !preview.error ? preview.callHash : null,
  )
  const notedCallHashRef = useRef<string | null>(null)
  useEffect(() => {
    const noted =
      preimageStatusQuery.data === "Unrequested" ||
      preimageStatusQuery.data === "Requested"
    if (noted && preview) notedCallHashRef.current = preview.callHash
  }, [preimageStatusQuery.data, preview])

  // The index setMetadata targets = referendumCount() when referenda.submit
  // executes. Refetched right before signing; a stale value makes setMetadata
  // fail the depositor check and the whole batch revert (see submit-proposal).
  const referendumCountQuery = useReferendumCount()
  const referendumIndexRef = useRef<number | null>(null)
  useEffect(() => {
    if (referendumCountQuery.data != null) {
      referendumIndexRef.current = referendumCountQuery.data
    }
  }, [referendumCountQuery.data])

  // The last staged draft, keyed by the content it was staged from, so a
  // retry after a rejected signature reuses it instead of minting a second
  // row. `draftForTxRef` is the draft the in-flight transaction anchors.
  const stagedRef = useRef<{ key: string; draft: DraftResponse } | null>(null)
  const draftForTxRef = useRef<DraftResponse | null>(null)

  // Resolve a signed-in session, prompting the wallet to sign the nonce if
  // needed. Returns false when the user cancels or the signature fails.
  const ensureSignedIn = useCallback(async (): Promise<boolean> => {
    if (meQuery.data) return true
    // The /api/auth/me poll can trail a fresh cookie - re-check before forcing
    // a signature the user may not actually need.
    try {
      const refreshed = await meQuery.refetch()
      if (refreshed.data) return true
    } catch {
      // fall through to the sign-in prompt
    }
    setSignInError(null)
    if (sign.isWalletConnect) setSignInModalOpen(true)
    try {
      await signIn.submit()
      setSignInModalOpen(false)
      toast.success("Signed in")
      return true
    } catch (e) {
      const message = formatError(e)
      setSignInError(message)
      if (!sign.isWalletConnect) {
        toast.error("Sign-in required", { description: message })
      }
      return false
    }
  }, [meQuery, sign.isWalletConnect, signIn])

  // Upload proposal.json to R2 + insert the draft row; returns the envelope
  // the batch anchors. Reuses the last draft when nothing it covers changed.
  const stageDraft = useCallback(async (): Promise<DraftResponse | null> => {
    if (!spec || !preview || preview.error || !resolvedOrigin || !proposerAddress) {
      return null
    }
    const key = JSON.stringify([
      chain.id,
      proposerAddress,
      resolvedOrigin.label,
      preview.callHash,
      title.trim(),
      summary.trim(),
      body,
    ])
    if (stagedRef.current?.key === key) return stagedRef.current.draft
    if (!(await ensureSignedIn())) return null
    setStaging(true)
    try {
      const res = await fetch("/api/proposals/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposal_id: crypto.randomUUID(),
          network: chain.id,
          proposer_address: proposerAddress,
          title: title.trim(),
          summary: summary.trim() || null,
          body_markdown: body,
          track: resolvedOrigin.label,
          beneficiary: spec.kind === "treasurySpend" ? spec.beneficiary : null,
          amount_planck: spec.kind === "treasurySpend" ? spec.amount.toString() : null,
          // An inline call is never noted, so there is no preimage to name.
          preimage_hash: preview.inline ? null : preview.callHash,
          preimage_len: preview.inline ? null : preview.len,
          attachments: [],
        }),
      })
      const json = (await res.json()) as DraftResponse | { ok: false; error: string }
      if (!res.ok || !("ok" in json) || !json.ok) {
        const err = "error" in json ? json.error : `HTTP ${res.status}`
        toast.error("Could not save the proposal details", { description: err })
        return null
      }
      stagedRef.current = { key, draft: json }
      return json
    } catch (e) {
      toast.error("Could not save the proposal details", { description: formatError(e) })
      return null
    } finally {
      setStaging(false)
    }
  }, [
    body,
    chain.id,
    ensureSignedIn,
    preview,
    proposerAddress,
    resolvedOrigin,
    spec,
    summary,
    title,
  ])

  const tx = useExtrinsic({
    // The confirm step persists the referendum index from the batch's events;
    // a reorg between inBlock and finality would pin the wrong one.
    resolveOn: "finalized",
    build: (api) => {
      if (!spec) throw new Error("Complete the proposal fields.")
      if (!resolvedOrigin) throw new Error("No valid submission origin for this amount.")
      const callBytes = buildProposalCall(api, spec).toU8a()
      const draft = draftForTxRef.current
      let metadata: { remarkPayload: string; referendumIndex: number } | undefined
      if (draft) {
        const referendumIndex = referendumIndexRef.current
        if (referendumIndex == null) {
          throw new Error("Couldn't read the next referendum index - try again in a moment.")
        }
        metadata = { remarkPayload: draft.remark_payload, referendumIndex }
      }
      // Small calls ride inline (no preimage deposit); larger ones are noted
      // as a preimage and referenced by Lookup.
      return buildProposalSubmission(api, {
        callBytes,
        origin: resolvedOrigin.origin,
        enactment: resolveEnactment(enactment),
        skipNote: notedCallHashRef.current === hashCall(callBytes),
        metadata,
      }).calls
    },
    async onSuccess({ events, txHash, blockHash }) {
      const index = extractReferendumIndex([...events])
      setSubmittedIndex(index)

      const draft = draftForTxRef.current
      if (!draft) return
      // This envelope is now bound to a referendum - never anchor it again.
      draftForTxRef.current = null
      stagedRef.current = null
      if (index == null) {
        setConfirmError("Couldn't read the new referendum index from the transaction events.")
        return
      }

      // The referendum is live either way; this only links the narrative.
      // Retry what can clear on its own, and never claim success for a link
      // that stuck.
      setConfirming(true)
      try {
        let blockNumber = 0
        const api = apiQuery.data as ApiPromise | undefined
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
        setConfirmError(
          await confirmWithRetry(draft.id, {
            referendum_index: index,
            tx_hash: txHash,
            block_hash: blockHash,
            block_number: blockNumber,
          }),
        )
      } catch (e) {
        setConfirmError(formatError(e))
      } finally {
        setConfirming(false)
      }
    },
    onStatus(status) {
      // Self-heal the AlreadyNoted dead-end: those call bytes are on chain, so
      // the next attempt must skip notePreimage instead of rebuilding the
      // batch that just reverted.
      if (status.kind === "error" && /AlreadyNoted/i.test(status.message) && preview) {
        notedCallHashRef.current = preview.callHash
      }
      if (sign.isWalletConnect) return
      if (status.kind === "error") {
        toast.error("Submission failed", { id: "adv-tx", description: status.message })
      }
    },
  })

  // Refresh the (stale-able) preimage status and referendum count right
  // before signing so the build closure sees on-chain reality, then submit.
  const submitTx = useCallback(async () => {
    if (preview && !preview.inline && !preview.error) {
      try {
        const res = await preimageStatusQuery.refetch()
        if (res.data === "Unrequested" || res.data === "Requested") {
          notedCallHashRef.current = preview.callHash
        }
      } catch {
        // Best-effort: fall back to what the seeded ref already holds.
      }
    }
    if (draftForTxRef.current) {
      try {
        const count = await referendumCountQuery.refetch()
        if (count.data != null) referendumIndexRef.current = count.data
      } catch {
        // Best-effort: fall back to the seeded ref; build throws if empty.
      }
    }
    void tx.submit()
  }, [preimageStatusQuery, preview, referendumCountQuery, tx])

  const meta = PROPOSAL_KIND_META[kind]
  const canSubmit =
    isConnected && spec != null && !fieldError && !enactmentError &&
    resolvedOrigin != null && preview != null && preview.error == null &&
    !detailsError && !tx.isSubmitting && !staging && !confirming

  const handleSubmit = async () => {
    if (!isConnected) {
      setWalletOpen(true)
      return
    }
    setConfirmError(null)
    let draft: DraftResponse | null = null
    if (attachDetails) {
      draft = await stageDraft()
      if (!draft) return
    }
    draftForTxRef.current = draft
    sign.open()
    void submitTx()
  }

  // Hash the exact wasm the upgrade will apply. The chain checks
  // applyAuthorizedUpgrade's code against this blake2-256, byte for byte.
  const onWasmFile = async (file: File | undefined) => {
    if (!file) return
    setHashingWasm(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
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
              Advanced proposal
            </h1>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              File any OpenGov proposal on {chain.name} - referendum admin,
              whitelisting, runtime upgrades, remarks, or a raw call - under the
              track origin of your choice, with an optional title and
              description shown on the proposal page. For treasury spends, the{" "}
              <Link href="/create" className="text-primary hover:underline">
                guided flow
              </Link>{" "}
              also handles attachments and resumable drafts.
            </p>
          </div>

          <div className="rounded-2xl bg-amber-500/5 border border-amber-500/30 p-4 mb-6 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              These proposals enact privileged calls. Pick the correct track
              origin for the call - an under-powered origin will fail at
              enactment after the full vote cycle. Review the decoded call below
              before signing.
            </p>
          </div>

          {/* Proposal type */}
          <Section title="Proposal type">
            <div className="grid grid-cols-2 gap-2">
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k)
                    setSubmittedIndex(null)
                    setConfirmError(null)
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

          {/* Type-specific fields */}
          <Section title="Details">
            {kind === "treasurySpend" && (
              <>
                <TextInput
                  label={`Amount (${chain.ticker})`}
                  value={fields.amount}
                  onChange={(v) => setField("amount", v)}
                  placeholder="e.g. 1000"
                  disabled={!isConnected}
                />
                <TextInput
                  label="Beneficiary address"
                  value={fields.beneficiary}
                  onChange={(v) => setField("beneficiary", v)}
                  placeholder="en…"
                  mono
                  disabled={!isConnected}
                />
              </>
            )}
            {(kind === "cancelReferendum" || kind === "killReferendum") && (
              <TextInput
                label="Referendum index"
                value={fields.index}
                onChange={(v) => setField("index", v)}
                placeholder="e.g. 42"
                disabled={!isConnected}
              />
            )}
            {kind === "whitelistCall" && (
              <TextInput
                label="Call hash (32-byte H256)"
                value={fields.callHash}
                onChange={(v) => setField("callHash", v)}
                placeholder="0x…"
                mono
                disabled={!isConnected}
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
                  disabled={!isConnected}
                />
                <label
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface-1 text-xs font-medium text-foreground transition-colors",
                    isConnected && !hashingWasm
                      ? "cursor-pointer hover:border-purple-border"
                      : "opacity-50 cursor-not-allowed",
                  )}
                >
                  {hashingWasm ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileUp className="w-3.5 h-3.5" />
                  )}
                  Compute from .wasm file
                  <input
                    type="file"
                    accept=".wasm,application/wasm"
                    className="sr-only"
                    disabled={!isConnected || hashingWasm}
                    onChange={(e) => {
                      void onWasmFile(e.target.files?.[0])
                      e.target.value = ""
                    }}
                  />
                </label>
                {wasmFile && (
                  <p className="text-[11px] text-muted-foreground">
                    Hashed <span className="font-mono text-foreground">{wasmFile.name}</span>{" "}
                    ({wasmFile.size.toLocaleString()} bytes). The file never leaves your
                    browser.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Hash the exact file you will apply - normally srtool&apos;s{" "}
                  <span className="font-mono">compact.compressed.wasm</span>. Once
                  the referendum enacts, anyone submits{" "}
                  <span className="font-mono">system.applyAuthorizedUpgrade</span>{" "}
                  with that file; any other bytes are rejected. A spec name
                  change or a version that doesn&apos;t increase voids the
                  authorization.
                </p>
              </>
            )}
            {kind === "remark" && (
              <TextArea
                label="Remark text"
                value={fields.remarkText}
                onChange={(v) => setField("remarkText", v)}
                placeholder="Anything - recorded on chain, no state change."
                disabled={!isConnected}
              />
            )}
            {kind === "rawCall" && (
              <TextArea
                label="SCALE-encoded call (hex)"
                value={fields.rawHex}
                onChange={(v) => setField("rawHex", v)}
                placeholder="0x…"
                disabled={!isConnected}
              />
            )}
            {fieldError && isConnected && (
              <p className="text-[11px] text-destructive mt-1">{fieldError}</p>
            )}
          </Section>

          {/* Origin */}
          <Section title="Submission origin (track)">
            {kind === "treasurySpend" ? (
              <p className="text-xs text-muted-foreground">
                Derived from the amount:{" "}
                <span className="text-primary font-mono">
                  {resolvedOrigin?.label ?? "-"}
                </span>
              </p>
            ) : (
              <>
                <select
                  value={originIdx}
                  disabled={!isConnected}
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
                  This call isn&apos;t run directly - it&apos;s enacted by a
                  referendum on the track you pick here, which sets who votes on
                  it and the passing thresholds.{" "}
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
              disabled={!isConnected}
              onChange={setEnactment}
            />
          </Section>

          <Section title="Proposal details">
            <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                checked={attachDetails}
                disabled={!isConnected}
                onChange={(e) => setAttachDetails(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>
                Attach a title and description. They&apos;re saved off-chain and
                bound to the new referendum with{" "}
                <span className="font-mono">referenda.setMetadata</span> in the
                same transaction (EGOV1), so they show on the proposal page.
                Requires signing in with your wallet.
              </span>
            </label>
            {attachDetails && (
              <>
                <Field
                  label="Title"
                  required
                  value={title}
                  onChange={setTitle}
                  placeholder="Clear, descriptive title (≥ 10 chars)"
                  maxLength={200}
                  hint={`${title.length}/200 characters`}
                  disabled={!isConnected}
                />
                <Field
                  label="Summary"
                  required
                  value={summary}
                  onChange={setSummary}
                  placeholder="1-3 sentences. Appears in list views."
                  multiline
                  rows={3}
                  maxLength={500}
                  hint={`${summary.length}/500 · ≥ 20 chars required`}
                  disabled={!isConnected}
                />
                <Field
                  label="Full proposal (markdown)"
                  required
                  value={body}
                  onChange={setBody}
                  placeholder="Motivation, what changes, how to verify it, risks. Markdown supported."
                  multiline
                  rows={10}
                  maxLength={100_000}
                  hint={`${body.length}/100,000 · ≥ 50 chars required · markdown`}
                  mono
                  disabled={!isConnected}
                />
                {detailsError && isConnected && (
                  <p className="text-[11px] text-muted-foreground">{detailsError}</p>
                )}
              </>
            )}
          </Section>

          {/* Preview */}
          {preview && (
            <Section title="Decoded call">
              {preview.error ? (
                <p className="text-[11px] text-destructive break-all">{preview.error}</p>
              ) : (
                <div className="space-y-1.5 text-xs">
                  <p className="font-mono text-foreground">
                    {preview.section}.{preview.method}
                  </p>
                  <p className="text-muted-foreground">
                    {preview.len} bytes ·{" "}
                    {preview.inline
                      ? "submitted inline (no preimage)"
                      : "noted as a preimage (Lookup)"}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground break-all">
                    {preview.hex.length > 140
                      ? `${preview.hex.slice(0, 140)}…`
                      : preview.hex}
                  </p>
                  {attachDetails && (
                    <p className="text-muted-foreground pt-1">
                      Batched with{" "}
                      <span className="font-mono">preimage.notePreimage</span>{" "}
                      (the EGOV1 envelope) and{" "}
                      <span className="font-mono">referenda.setMetadata</span> -
                      one signature, applied together or not at all.
                    </p>
                  )}
                </div>
              )}
            </Section>
          )}

          {submittedIndex != null ? (
            <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/30 p-5 space-y-3">
              <p className="text-sm font-semibold text-foreground">
                Referendum #{submittedIndex} submitted
              </p>
              {confirming && (
                <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Linking the proposal details…
                </p>
              )}
              {confirmError && (
                <p className="text-xs text-amber-300 leading-relaxed">
                  The referendum is live, but linking its details failed:{" "}
                  {confirmError}
                </p>
              )}
              {kind === "authorizeUpgrade" && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Once it enacts, apply the upgrade by submitting{" "}
                  <span className="font-mono">system.applyAuthorizedUpgrade</span>{" "}
                  with the same wasm file, from any account.
                </p>
              )}
              <Link
                href={`/proposals/${submittedIndex}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View proposal
                <ArrowRight className="w-3 h-3" />
              </Link>
              <p className="text-xs text-muted-foreground">
                File the decision deposit to start the deciding clock:
              </p>
              <PlaceDepositButton
                referendumIndex={submittedIndex}
                trackName={resolvedOrigin?.label ?? null}
                chain={chain}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isConnected && !canSubmit}
              className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {(tx.isSubmitting || staging) && <Loader2 className="w-4 h-4 animate-spin" />}
              {!isConnected
                ? "Connect wallet to submit"
                : staging
                  ? "Saving proposal details…"
                  : "Sign & submit proposal"}
            </button>
          )}
        </div>
      </main>
      <Footer />

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
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
          void submitTx()
        }}
      />
      <SignRequestModal
        open={signInModalOpen}
        walletName={walletMeta.name}
        walletIcon={walletMeta.icon}
        subtitle="Sign in to save your proposal details"
        status={
          signInError
            ? { kind: "error", message: signInError }
            : { kind: "signing" }
        }
        deepLinkUrl={sign.deepLinkUrl}
        onClose={() => setSignInModalOpen(false)}
        onRetry={() => {
          setSignInError(null)
          signIn
            .submit()
            .then(() => {
              setSignInModalOpen(false)
              toast.success("Signed in")
            })
            .catch((e) => setSignInError(formatError(e)))
        }}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card border border-border p-5 space-y-3 mb-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  )
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  disabled?: boolean
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type="text"
        value={value}
        spellCheck={false}
        disabled={disabled}
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

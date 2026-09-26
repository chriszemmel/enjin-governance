"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import type { ApiPromise } from "@polkadot/api"
import { u8aToHex } from "@polkadot/util"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { WalletModal } from "@/components/wallet/wallet-modal"
import { SignRequestModal } from "@/components/wallet/sign-request-modal"
import { PlaceDepositButton } from "@/components/governance/place-deposit-button"
import { AddressFormatDialog } from "@/components/create/address-format-dialog"
import { EnactmentField } from "@/components/create/enactment-field"
import { cn } from "@/lib/utils"
import { subscanExtrinsicUrl } from "@/lib/chain/chains"
import { useActiveChain } from "@/lib/chain/use-chain"
import { parseTokenAmount } from "@/lib/chain/format"
import { encodeForChain, inspectAddress, isValidAddressForChain } from "@/lib/chain/ss58"
import {
  buildProposalCall,
  PROPOSAL_KIND_META,
  SUBMIT_ORIGINS,
  type ProposalCallSpec,
  type ProposalKind,
} from "@/lib/governance/proposal-calls"
import { buildSubmit, extractReferendumIndex } from "@/lib/governance/referenda"
import { canInline, noteAndHash } from "@/lib/governance/preimage"
import {
  DEFAULT_ENACTMENT,
  resolveEnactment,
  validateEnactment,
  type EnactmentChoice,
} from "@/lib/governance/enactment"
import { pickOriginForAmount } from "@/lib/governance/treasury"
import { useApi } from "@/lib/query/hooks/use-api"
import { useCurrentBlock } from "@/lib/query/hooks/use-current-block"
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
  "runtimeUpgrade",
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
  const { status: walletStatus, session, activeAddress } = useWallet()
  const isConnected = walletStatus === "connected"
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

  const setField = (k: keyof Fields, v: string) =>
    setFields((f) => ({ ...f, [k]: v }))

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
          if (!isHex(fields.codeHex) || fields.codeHex.length < 10) {
            return { spec: null, fieldError: "Paste the runtime wasm as hex (0x…)." }
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
        error: null as string | null,
      }
    } catch (e) {
      return {
        section: "",
        method: "",
        len: 0,
        inline: false,
        hex: "0x",
        error: formatError(e),
      }
    }
  }, [apiQuery.data, spec])

  const tx = useExtrinsic({
    resolveOn: "finalized",
    build: (api) => {
      if (!spec) throw new Error("Complete the proposal fields.")
      if (!resolvedOrigin) throw new Error("No valid submission origin for this amount.")
      const call = buildProposalCall(api, spec)
      const bytes = call.toU8a()
      const enact = resolveEnactment(enactment)
      // Small calls ride inline (no preimage deposit); larger ones are noted
      // as a preimage and referenced by Lookup.
      if (canInline(bytes)) {
        return buildSubmit(api, {
          origin: resolvedOrigin.origin,
          proposal: { inline: bytes },
          enactment: enact,
        })
      }
      const { extrinsic, hash, len } = noteAndHash(api, bytes)
      return [
        extrinsic,
        buildSubmit(api, {
          origin: resolvedOrigin.origin,
          proposal: { hash, len },
          enactment: enact,
        }),
      ]
    },
    onSuccess({ events }) {
      setSubmittedIndex(extractReferendumIndex([...events]))
    },
    onStatus(status) {
      if (sign.isWalletConnect) return
      if (status.kind === "error") {
        toast.error("Submission failed", { id: "adv-tx", description: status.message })
      }
    },
  })

  const meta = PROPOSAL_KIND_META[kind]
  const canSubmit =
    isConnected && spec != null && !fieldError && !enactmentError &&
    resolvedOrigin != null && preview?.error == null && !tx.isSubmitting

  const handleSubmit = () => {
    if (!isConnected) {
      setWalletOpen(true)
      return
    }
    sign.open()
    void tx.submit()
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
              track origin of your choice. For treasury spends with rich
              metadata, use the{" "}
              <Link href="/create" className="text-primary hover:underline">
                guided flow
              </Link>
              .
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
            {kind === "runtimeUpgrade" && (
              <TextArea
                label="Runtime code (wasm hex)"
                value={fields.codeHex}
                onChange={(v) => setField("codeHex", v)}
                placeholder="0x…"
                disabled={!isConnected}
              />
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
                </div>
              )}
            </Section>
          )}

          {submittedIndex != null ? (
            <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/30 p-5 space-y-3">
              <p className="text-sm font-semibold text-foreground">
                Referendum #{submittedIndex} submitted
              </p>
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
              onClick={handleSubmit}
              disabled={isConnected && !canSubmit}
              className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tx.isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isConnected ? "Sign & submit proposal" : "Connect wallet to submit"}
            </button>
          )}
        </div>
      </main>
      <Footer />

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      {kind === "treasurySpend" && beneficiaryInspection.status === "foreign" && (
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
          void tx.submit()
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

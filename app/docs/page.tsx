import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  Coins,
  ExternalLink,
  FileJson,
  Hash,
  Hourglass,
  Pencil,
  Send,
  ShieldCheck,
  Users,
  Vote,
  Wallet,
  XOctagon,
} from "lucide-react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"
import { FoundABugModal } from "@/components/layout/found-a-bug-modal"
import { CHAINS } from "@/lib/chain/chains"

export const metadata = {
  title: "Docs - Enjin Governance",
  description:
    "How the Enjin Governance client works, the EGOV1 metadata standard, and integration notes for indexers and wallets.",
}

/**
 * One-stop reference for end users + integrators. Statically rendered
 * markdown-like sections, table of contents at the top, anchored
 * section IDs so we can hand-link from the rest of the app
 * (e.g. wallet-issues from a connect error).
 *
 * Kept in code rather than rendered from /docs/*.md so we can mix
 * lucide icons and inline links without pulling a heavy markdown
 * pipeline into the bundle.
 */
export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <div className="max-w-3xl mx-auto space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold text-foreground">Docs</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              How the Enjin Governance client works, the EGOV1 off-chain
              metadata standard, and integration notes for indexers, wallets,
              and other front-ends.
            </p>
          </header>

          <TableOfContents />

          <Section id="overview" title="What this is" icon={<Coins />}>
            <p>
              A production web client for Enjin OpenGov - the on-chain
              governance system that lives on the Enjin Relaychain. Any
              tokenholder can browse referenda, vote with conviction, unlock
              expired locks, and file new treasury proposals end-to-end without
              leaving the browser. Mainnet is supported today; Canary is
              available from the chain selector for testing flows before
              committing real funds.
            </p>
            <p>
              The chain RPC is the source of truth for everything that votes,
              moves money, or locks tokens. The off-chain layer is for the
              parts a chain shouldn&apos;t carry: long-form narrative, comments,
              attachments, proposer profiles.
            </p>
          </Section>

          <Section
            id="lifecycle"
            title="How a proposal flows"
            icon={<Send />}
          >
            <p>
              The wizard composes up to four calls and wraps them in a single{" "}
              <Code>utility.batchAll</Code> so the submission either lands
              whole or reverts whole:
            </p>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>
                <Code>preimage.notePreimage(call_bytes)</Code> - stores
                the actual treasury call. Returns a (hash, length) pair the
                referendum will reference.
              </li>
              <li>
                <Code>referenda.submit(origin, Lookup &#123;hash, len&#125;, enactment)</Code>{" "}
                - opens the referendum on the smallest treasury track
                whose authority covers the spend amount.
              </li>
              <li>
                <Code>preimage.notePreimage(&quot;EGOV1:&#123;u, h&#125;&quot;)</Code>{" "}
                - stores a content-addressed pointer to the off-chain
                JSON (see <A href="#egov1">EGOV1 standard</A>).
              </li>
              <li>
                <Code>referenda.setMetadata(index, blake2_256(envelope))</Code>{" "}
                - binds that pointer to the referendum, where{" "}
                <Code>index</Code> is <Code>referendumCount()</Code> read at
                build time. If another submission lands first the index is
                stale, the runtime rejects it with{" "}
                <Code>NoPermission</Code>, and the whole batch reverts - a
                stale index can never annotate someone else&apos;s
                referendum.
              </li>
            </ol>
            <p>
              Step 1 is skipped when the preimage for these exact bytes is
              already on chain. The wizard checks{" "}
              <Code>api.query.preimage.requestStatusFor(hash)</Code> before
              building the batch - if the status is{" "}
              <Code>Unrequested</Code> or <Code>Requested</Code>, re-noting
              would abort with <Code>AlreadyNoted</Code> and revert the whole
              batch, so the wizard drops step 1 and signs the remaining
              three calls. The referendum still references the same
              (hash, len) pair, so the on-chain outcome is identical.
            </p>
            <p>
              The proposer separately places the per-track decision deposit
              (any account can pay it) - it is never part of the
              submission batch. Both the submission and decision deposits
              refund automatically when the referendum reaches a terminal
              state. Voters cast <Code>convictionVoting.vote</Code> over the
              decision period; the chain dispatches the noted call at
              enactment if approval and support curves are satisfied.
            </p>
            <p>
              Spend authority is mapped from amount to track by{" "}
              <Code>pickOriginForAmount</Code>. The runtime tiers:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>SmallTipper - up to 250 ENJ</li>
              <li>BigTipper - up to 1,000 ENJ</li>
              <li>SmallSpender - up to 10,000 ENJ</li>
              <li>MediumSpender - up to 100,000 ENJ</li>
              <li>BigSpender - up to 1,000,000 ENJ (cap)</li>
            </ul>
            <p>
              Enjin has no Treasurer track, so BigSpender is the top tier.
              Requests above 1,000,000 ENJ are not supported and the wizard
              blocks them.
            </p>
          </Section>

          <Section
            id="egov1"
            title="EGOV1 off-chain metadata standard"
            icon={<FileJson />}
          >
            <p>
              EGOV1 is the standard the client uses to attach a title,
              summary, body, attachments, and signature to an on-chain
              referendum without bloating chain state. It&apos;s designed so
              any third party - Polkassembly, Subscan, an indexer, or another
              client - can rebuild the proposal corpus by resolving{" "}
              <Code>referenda.metadataOf</Code> through the preimage pallet
              and filtering for the <Code>EGOV1:</Code> magic prefix.
            </p>

            <h3 className="text-base font-semibold text-foreground pt-2">
              On-chain envelope
            </h3>
            <p>
              The submission batch notes a preimage with the UTF-8 payload
              below and binds its blake2-256 to the referendum via{" "}
              <Code>referenda.setMetadata</Code>:
            </p>
            <Pre>{`EGOV1:{"u":"<url>","h":"<sha256-hex>"}`}</Pre>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <Code>u</Code> - public URL of the canonical{" "}
                <Code>proposal.json</Code>.
              </li>
              <li>
                <Code>h</Code> - sha256 of the canonical
                (sorted-keys-at-every-level) JSON bytes. Pinned forever by
                the on-chain envelope.
              </li>
              <li>
                Canonical means keys sorted lexicographically at every level,{" "}
                <strong>no insignificant whitespace</strong> (
                <Code>JSON.stringify</Code>&apos;s default separators), UTF-8
                bytes; arrays keep their order. Pretty-printing the same object
                yields a different sha256, so a reimplementation that indents
                will read every proposal as tampered.
              </li>
              <li>
                Non-ASCII characters are emitted{" "}
                <strong>literally as UTF-8</strong>, never as{" "}
                <Code>\uXXXX</Code>{" "}escapes. This is the second way a
                reimplementation silently diverges: Python&apos;s{" "}
                <Code>json.dumps</Code> escapes non-ASCII by default, so any
                proposal containing an em dash, a curly quote or an accented
                name hashes differently unless it passes{" "}
                <Code>ensure_ascii=False</Code>.
              </li>
            </ul>

            <h3 className="text-base font-semibold text-foreground pt-2">
              proposal.json shape
            </h3>
            <Pre>{`{
  "schema": "enjin-governance-proposal",
  "version": "1.1.0" | "1.2.0",
  "network": "enjin-relay" | "enjin-matrix" | "canary-relay" | "canary-matrix",
  "proposer": "<SS58 address>",
  "title": "<≤ 200 chars>",
  "summary": "<≤ 500 chars> | null",
  "body_markdown": "<≤ 100000 chars>",
  "track": "<track name, e.g. SmallTipper or root — ≤ 80 chars>" | null,
  "spend": {
    "beneficiary": "<SS58 address>",
    "amount_planck": "<decimal string>"
  } | null,
  "attachments": [{
    "name": "<filename>",
    "url": "<public URL>",
    "sha256": "<hex>",
    "content_type": "<MIME>",
    "size_bytes": <int>
  }],
  "call": {                       // 1.2.0, optional
    "section": "<pallet, e.g. system>",
    "method": "<call, e.g. setCode>",
    "origin": "<track origin, e.g. Root>",
    "preimage_hash": "<0x… blake2-256 of the call>",
    "preimage_len": <int>,
    "inline": <bool>,
    "code_hash": "<0x… blake2-256 of the runtime> | null"
  } | null,
  "enactment": { "type": "At" | "After", "block": <int> } | null,  // 1.2.0
  "preimage_hash": "<0x… hex> | null",
  "preimage_len": <int> | null,
  "created_at": "<ISO 8601>",
  "edited_at": "<ISO 8601> | null",
  "edit_count": <int>,
  "signature": {
    "address": "<SS58>",
    "sig": "<hex>"
  } | null
}`}</Pre>
            <p>
              All <Code>amount_planck</Code> values are decimal strings (not
              numbers) to preserve precision - the relay has 18
              decimals, which overflows <Code>Number</Code>.
            </p>
            <p>
              <strong>Version 1.2.0</strong> adds the optional{" "}
              <Code>call</Code> and <Code>enactment</Code> sections, written
              for proposals filed through the advanced composer (runtime
              upgrades, cancel / kill, whitelisting, remarks, raw calls).
              Every other field is unchanged, so 1.1.0 readers keep working.
              The <Code>call</Code> section is what the proposer recorded;
              the proposal page still decodes the call from the preimage on
              chain, and for runtime upgrades shows the code hash computed
              from it. Referenda filed elsewhere can get the same details
              afterwards: the account that submitted one signs{" "}
              <Code>preimage.notePreimage</Code> +{" "}
              <Code>referenda.setMetadata</Code> while it is ongoing.
            </p>
            <p>
              <strong>Attachments</strong> live next to the JSON under{" "}
              <Code>proposals/&lt;network&gt;/&lt;id&gt;/media/</Code>. The
              server builds each <Code>url</Code> from that key, and images
              are stored without their metadata (no GPS) and scaled to fit
              2560 px; the <Code>sha256</Code> is of the stored file. The
              body can show an attachment with{" "}
              <Code>![caption](&lt;attachment url or file name&gt;)</Code>.
              Only the proposal&apos;s own attachments render as images;
              any other image link is shown as a plain link, so nothing in a
              proposal can be swapped or used to track readers after voting
              starts.
            </p>
            <p>
              <Code>track</Code> is a free-form label, not an enum, and{" "}
              <strong>its casing is not normalised</strong>. Treasury
              proposals filed through this client carry the PascalCase Origins
              variant (<Code>SmallTipper</Code>); proposals filed elsewhere
              carry whatever their author wrote, typically the runtime track
              name (<Code>root</Code>). Match case-insensitively, and treat an
              unrecognised value as opaque rather than dropping the proposal.
            </p>

            <h3 className="text-base font-semibold text-foreground pt-2">
              Discovery for indexers
            </h3>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>
                Read <Code>referenda.metadataOf(index)</Code> and resolve the
                hash through the <Code>preimage</Code> pallet to the envelope
                bytes. For referenda filed before this binding shipped, fall
                back to scanning finalised blocks for <Code>system.remark</Code>{" "}
                calls nested in the submission&apos;s{" "}
                <Code>utility.batchAll</Code>.
              </li>
              <li>
                Filter payloads whose UTF-8 bytes start with{" "}
                <Code>EGOV1:</Code>.
              </li>
              <li>
                JSON-parse the suffix to get <Code>{"{u, h}"}</Code>.
              </li>
              <li>
                Fetch <Code>u</Code>. The bytes are guaranteed to start as
                the JSON committed on chain at <Code>h</Code>; if the
                proposer edited later (see{" "}
                <A href="#editing">Editing &amp; withdrawal</A>) the bucket
                bytes will differ from <Code>h</Code>{" "}- that&apos;s the
                public signal an edit happened.
              </li>
              <li>
                The referendum link is explicit: <Code>MetadataOf</Code> is
                keyed by index. For legacy remarks, link via the same
                extrinsic: the batch that emitted the remark is the one that
                emitted <Code>referenda.Submitted&#123;index&#125;</Code>.
              </li>
            </ol>
            <p>
              Result: anyone can rebuild the proposal corpus without any
              dependency on this app&apos;s database.
            </p>
          </Section>

          <Section
            id="editing"
            title="Editing & withdrawal"
            icon={<Pencil />}
          >
            <p>
              Proposers can update the off-chain narrative after submission
              from the <strong>Edit Proposal</strong> page on the referendum.
              The PATCH endpoint overwrites <Code>proposal.json</Code> at the
              same bucket key, so existing URLs keep resolving - but the
              sha256 changes, and the on-chain envelope still pins the
              original hash. The detail page shows an <Code>(edited)</Code> chip and
              the EGOV1 source modal explains the divergence.
            </p>
            <p>
              <strong>What you can edit</strong>: title, summary, body,
              attachments.{" "}
              <strong>What you can&apos;t</strong>: spend amount, beneficiary,
              preimage, proposer address, track - those are baked into
              the referendum and would invalidate the on-chain state.
            </p>
            <p>
              <strong>Withdraw</strong>{" "}is the social signal for &quot;I
              filed this in error, please vote NAY&quot;: it records a{" "}
              <Code>withdrawn_at</Code>{" "}timestamp plus an optional reason, and
              the detail page renders a destructive-tone banner. The on-chain
              referendum is unchanged - substrate&apos;s{" "}
              <Code>referenda.cancel</Code> is locked to the{" "}
              <Code>ReferendumCanceller</Code>{" "}origin, not the proposer. To
              actually move the tally you can vote NAY yourself with high
              conviction, file a separate cancellation referendum, or wait
              for the decision period to expire if the deposit isn&apos;t
              placed (it is here, so that path is moot).
            </p>
          </Section>

          <Section
            id="voting"
            title="Voting & conviction locks"
            icon={<Vote />}
          >
            <p>
              Votes carry a conviction multiplier between 1x and 6x. Higher
              conviction multiplies the vote&apos;s tally weight but locks
              the underlying balance for a period after the referendum
              resolves. The lock grows with conviction, roughly doubling each
              step: 1x = 1, 2x = 2, 3x = 4, 4x = 8, 5x = 16, 6x = 32 lock
              periods. Lock duration is per track-class - the same conviction
              on BigSpender is much longer than on SmallTipper.
            </p>

            <h3 className="text-base font-semibold text-foreground pt-2">
              What voters can do
            </h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>Cast a vote</strong> -{" "}
                <Code>vote(pollIndex, accountVote, currency)</Code> with an
                Aye or Nay verdict, a 1x-6x conviction multiplier, and
                a vote source (liquid ENJ or a specific sENJ pool).
              </li>
              <li>
                <strong>Change a vote</strong> - re-submit{" "}
                <Code>vote</Code> for the same referendum to swap the
                verdict, conviction, or source. The chain overwrites the
                previous <Code>AccountVote</Code>{" "}in the same lock class
                - no separate &quot;edit&quot; extrinsic.
              </li>
              <li>
                <strong>Remove a vote</strong> -{" "}
                <Code>removeVote(trackId, pollIndex)</Code> pulls your
                weight back out of the tally. Called before the decision
                period ends, it withdraws the vote and starts the lock from
                now; called after the referendum resolves, it just frees the
                vote record so the lock can be unlocked.
              </li>
              <li>
                <strong>Unlock locked balance</strong> - the{" "}
                <Code>/unlock</Code> page reads{" "}
                <Code>convictionVoting.classLocksFor(account)</Code> and
                lets you submit <Code>unlock(class, target)</Code> for any
                class whose lock period has expired.
              </li>
            </ul>

            <h3 className="text-base font-semibold text-foreground pt-2">
              Vote source: liquid ENJ or sENJ
            </h3>
            <p>
              Enjin&apos;s extended <Code>AccountVote</Code> carries a{" "}
              <Code>currency</Code> arg so a single voter can source a vote
              from either:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Liquid ENJ</strong> -{" "}
                <Code>{"{ Enj: null }"}</Code>. The default.
              </li>
              <li>
                <strong>Staked ENJ from a specific pool</strong> -{" "}
                <Code>{"{ SEnj: <poolId> }"}</Code>. sENJ lives in the
                {" "}<Code>multiTokens</Code> pallet under collection{" "}
                <Code>1</Code> with{" "}
                <Code>tokenId === poolId</Code>. Your balance for pool N is{" "}
                <Code>
                  tokenAccounts(1, N, account).balance
                </Code>
                . Pool art (the &quot;Degens&quot; NFTs) lives separately in
                collection <Code>2</Code>.
              </li>
            </ul>
            <p>
              sENJ accrues staking rewards, so 1 sENJ &gt; 1 ENJ. The per-pool
              stake factor is{" "}
              <Code>
                staking.ledger(stash).active / multiTokens.tokens(1, N).supply
              </Code>
              , and the ENJ-equivalent is{" "}
              <Code>senjBalance * stakeFactor</Code>. The vote panel shows
              both numbers next to each source so voters know what they&apos;re
              contributing in real terms. The on-chain extrinsic still takes
              the sENJ amount - the stake factor is display-only.
            </p>
            <p>
              The vote panel automatically detects every pool you hold sENJ
              in and lets you pick which source to vote from. When you have
              no sENJ, the selector hides and you just vote with liquid ENJ.
              Conviction multipliers and lock periods apply the same way to
              either source.
            </p>

            <h3 className="text-base font-semibold text-foreground pt-2">
              voteManager vs convictionVoting
            </h3>
            <p>
              Enjin Relay&apos;s governance runs on a multi-token fork of the
              standard <Code>convictionVoting</Code> pallet - the same OpenGov
              semantics (Aye/Nay verdict, 1x-6x conviction multipliers,
              per-class lock schedule, support/approval curves), with one
              addition: every vote, delegation, and unlock carries a{" "}
              <Code>currency</Code> argument so it can source liquid ENJ or a
              staked-ENJ pool token (sENJ).
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <Code>convictionVoting.vote(pollIndex, accountVote, currency)</Code>
                {" "}- the deployed Enjin surface (3-arg, multi-token). Stock
                Substrate / Polkadot is the 2-arg version without{" "}
                <Code>currency</Code>.
              </li>
              <li>
                <Code>voteManager</Code> - a fallback surface the client also
                supports for any runtime that exposes it; the current Enjin
                Relay runtime does not, so governance goes through{" "}
                <Code>convictionVoting</Code>.
              </li>
            </ul>
            <p>
              The client probes runtime metadata to pick the right pallet and
              the right call arity automatically, so the per-vote{" "}
              <Code>currency</Code> argument is never dropped. If you compare
              past Subscan extrinsics they may show <Code>votemanager (vote)</Code>
              {" "}or <Code>Convictionvoting (Vote)</Code> depending on which
              pallet the runtime exposed at the time.
            </p>
          </Section>

          <Section
            id="verification"
            title="Verification"
            icon={<ShieldCheck />}
          >
            <p>
              The badge on every proposal&apos;s About card maps the bucket
              JSON&apos;s integrity to one of four colour-coded states:
            </p>
            <ul className="space-y-2.5">
              <li className="flex items-start gap-3">
                <SourceBadgeSample
                  label="EGOV1 · Verified"
                  tone="border-emerald-500/40 text-emerald-400 bg-emerald-500/5"
                />
                <span>
                  Bucket sha256 matches our DB record and the hash pinned on
                  chain at submission - the narrative you see is
                  byte-for-byte what the proposer submitted.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <SourceBadgeSample
                  label="EGOV1 · Edited"
                  tone="border-purple-border text-primary bg-primary/5"
                />
                <span>
                  The proposer set <Code>edited_at</Code>: they overwrote the
                  bucket JSON after submission. Bucket sha256 still matches
                  our (updated) DB record, but it diverges from the sha256
                  pinned on chain - that divergence is the public edit
                  signal.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <SourceBadgeSample
                  label="EGOV1 · Unverified"
                  tone="border-red-500/40 text-red-400 bg-red-500/5"
                />
                <span>
                  Bucket sha256 doesn&apos;t match what we expected and no
                  edit is recorded. Treat the narrative with suspicion until
                  the issue is investigated.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <SourceBadgeSample
                  label="EGOV1 · Fetch Failed"
                  tone="border-amber-500/40 text-amber-300 bg-amber-500/5"
                />
                <span>
                  The bucket URL didn&apos;t respond. Not a verification
                  result, just a transport failure - retry when the CDN
                  recovers.
                </span>
              </li>
            </ul>
            <p>
              External indexers should additionally check that the bucket
              sha256 matches the <Code>h</Code> pinned by the on-chain
              envelope.
              When that fails but <Code>edited_at</Code> is present in the
              JSON, the proposer edited after submission; when{" "}
              <Code>edited_at</Code> is absent, treat the content as
              tampered.
            </p>
          </Section>

          <Section id="wallets" title="Wallet integration" icon={<Wallet />}>
            <p>Supported connectors:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Enjin Wallet</strong> - WalletConnect v2,
                desktop QR or mobile deep link
              </li>
              <li>
                <strong>Polkadot browser extensions</strong> -
                Polkadot.js, Talisman, SubWallet, PolkaGate
              </li>
            </ul>
            <p>
              All connectors implement the same <Code>Connector</Code>{" "}
              interface and produce a Polkadot{" "}
              <Code>Signer</Code> the rest of the app uses identically.
            </p>

            <h3
              id="wallet-issues"
              className="text-base font-semibold text-foreground pt-2"
            >
              Known issues
            </h3>
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/30 p-4 space-y-2 text-xs leading-relaxed">
              <p className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">
                    WalletConnect deep links on iOS Safari
                  </strong>{" "}
                  must fire from inside a fresh user-gesture frame, not a
                  promise callback. The sign-request modal wraps the
                  &quot;Open in Enjin Wallet&quot; button accordingly - if
                  it stops working, check that no async hop sits between the
                  click and the deep link.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">
                    Double sign prompts on iOS
                  </strong>{" "}
                  - iOS Safari can fire two click handlers when the
                  app-switcher prompt returns. Sign flows guard against this
                  with a module-level in-flight lock.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">SS58 prefix drift</strong>{" "}
                  - some wallets return addresses in their default
                  prefix instead of the active chain&apos;s.
                  <Code>encodeForChain</Code> normalises before display, and
                  ownership checks compare by public key (
                  <Code>samePublicKey</Code>) so the same wallet on Canary
                  (<Code>cn…</Code>) still matches a proposal filed on Enjin
                  Relay (<Code>en…</Code>).
                </span>
              </p>
              <p className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">RPC reconnects</strong>{" "}
                  - the relay RPC can drop briefly under load. Tx
                  builders wait up to a few seconds for the API to come back
                  before failing with a friendly &quot;please try again&quot;
                  error; the proposal list auto-refreshes on tab focus.
                </span>
              </p>
            </div>
          </Section>

          <Section id="identity" title="Identity & comments" icon={<Users />}>
            <p>
              A connected wallet is enough to browse referenda and cast
              votes - everything that touches chain state runs through
              a signed extrinsic, so the wallet is the only authority that
              matters. On top of that, the client adds a lightweight social
              layer so voters can put a face to an address and talk through
              proposals before they go to tally. It&apos;s deliberately
              minimal: a profile, a verified comment thread per referendum,
              no DMs, no upvotes, no forum.
            </p>

            <h3 className="text-base font-semibold text-foreground pt-2">
              Sign-in with wallet (proof of control)
            </h3>
            <p>
              Connecting a wallet only proves the wallet exposed an address;
              signing a server-issued nonce proves the wallet controls the
              private key. The sign-in flow follows the SIWE pattern adapted
              for Substrate: <Code>POST /api/auth/nonce</Code>{" "}hands back a
              16-byte hex nonce, the client builds a plain-text message
              (&quot;Enjin Governance - sign in&quot; + address +
              nonce + issued timestamp), the wallet signs it, and{" "}
              <Code>POST /api/auth/verify</Code> checks the signature with{" "}
              <Code>@polkadot/util-crypto</Code>&apos;s{" "}
              <Code>signatureVerify</Code>{" "}(accepts the wallet&apos;s{" "}
              <Code>&lt;Bytes&gt;</Code> wrapping, plain, and{" "}
              <Code>0x</Code>-hex forms).
            </p>
            <p>
              On success the server returns a 32-byte opaque bearer token in
              the <Code>enjin-governance:session</Code> cookie
              (<Code>HttpOnly</Code>, <Code>Secure</Code> in production,{" "}
              <Code>SameSite=Lax</Code>, 30-day TTL). Only the SHA-256 hash
              of the token lives in <Code>wallet_sessions</Code>{" "}- the
              raw secret never persists, so a DB leak doesn&apos;t hand out
              live sessions. Sessions never authorise on-chain transactions;
              they only gate the off-chain social writes below.
            </p>

            <h3 className="text-base font-semibold text-foreground pt-2">
              Profile
            </h3>
            <p>
              Once signed in, an address can attach a profile to itself:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Handle</strong> - case-insensitive unique,
                3-32 chars, <Code>[a-z0-9_]</Code>.
              </li>
              <li>
                <strong>Display name</strong> - up to 80 chars, free
                text.
              </li>
              <li>
                <strong>Bio</strong> - up to 500 chars.
              </li>
              <li>
                <strong>Avatar</strong>{" "}- PNG/JPEG/WebP/GIF up to
                6 MB, transcoded server-side to a 150&times;150 PNG with
                EXIF stripped, stored in R2 at{" "}
                <Code>user-avatars/&#123;user_uuid&#125;.png</Code>.
              </li>
            </ul>
            <p>
              Profiles are read publicly via{" "}
              <Code>GET /api/users/by-address/&#123;address&#125;</Code>{" "}
              (no auth, cached 60s edge / 600s stale-while-revalidate) and
              written only by the owner via{" "}
              <Code>PATCH /api/users/me</Code>. A separate{" "}
              <Code>is_verified</Code>{" "}boolean is reserved for manual
              attestation by the maintainers - there&apos;s no
              self-service path to turn it on.
            </p>

            <h3 className="text-base font-semibold text-foreground pt-2">
              Public comments
            </h3>
            <p>
              Each referendum carries a flat comment thread.{" "}
              <Code>GET /api/proposals/&#123;uuid&#125;/comments</Code> is
              public; <Code>POST</Code>{" "}requires a valid session, accepts
              1-10,000 chars of markdown, and stamps the comment with
              the signer&apos;s <Code>user_id</Code> and{" "}
              <Code>address</Code> so authorship is always traceable to a
              wallet that proved control. Comment rows surface{" "}
              <Code>author_handle</Code>, <Code>author_display_name</Code>,
              <Code>author_avatar_url</Code>, and{" "}
              <Code>author_is_verified</Code> for the UI.
            </p>
            <p>
              Authors can soft-delete their own comments via{" "}
              <Code>DELETE /api/comments/&#123;id&#125;</Code> - the
              row stays with <Code>is_deleted = true</Code> and the body
              replaced by <Code>[deleted]</Code>. There is no edit endpoint,
              no moderator delete, no flag/report flow, and no reaction or
              upvote UI. The <Code>parent_id</Code> column on{" "}
              <Code>comments</Code> reserves space for threading, but the
              current UI renders the thread flat by{" "}
              <Code>created_at</Code>.
            </p>

            <h3 className="text-base font-semibold text-foreground pt-2">
              Address page
            </h3>
            <p>
              <Code>/user/&#123;address&#125;</Code> is the public profile
              view: avatar, display name (or <Code>@handle</Code>, or
              shortened address as a fallback), verified badge, bio, full
              address, and a list of referenda the address has authored.
              Addresses that have never signed in still resolve - the
              page just shows &quot;No profile yet&quot; in place of the
              social fields and continues to list their on-chain activity.
            </p>

            <h3 className="text-base font-semibold text-foreground pt-2">
              What&apos;s intentionally out of scope
            </h3>
            <p>
              No direct messages, no upvotes or reactions, no
              proposal-agnostic forum, no threaded reply UI, no moderation
              tools, no comment edit history. The social layer exists to give
              voters context and let proposers respond - if the conversation
              outgrows what a flat per-referendum thread can carry, that&apos;s
              the signal to move the discussion to a dedicated venue, not to
              build one inside this client.
            </p>
          </Section>

          <Section
            id="chain-coordinates"
            title="Chain coordinates"
            icon={<Hash />}
          >
            <p>
              Values come from <Code>lib/chain/chains.ts</Code>. Mainnet is
              Enjin Relay; Canary mirrors the same governance pallets for
              testing flows before committing real funds.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ChainCard chainId="enjin-relay" tone="primary" />
              <ChainCard chainId="canary-relay" tone="testnet" />
            </div>
          </Section>

          <Section
            id="timing"
            title="Timing primitives"
            icon={<Hourglass />}
          >
            <p>Each track has its own periods:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Prepare period</strong> - from submission until
                a decision can start. Decision deposit must be placed before
                it expires or the referendum times out.
              </li>
              <li>
                <strong>Decision period</strong> - voting is open;
                approval and support curves are evaluated continuously.
              </li>
              <li>
                <strong>Confirm period</strong> - the curves must hold
                continuously for the full confirm duration to pass.
              </li>
              <li>
                <strong>Enactment delay</strong> - after approval, the
                noted call dispatches this many blocks later.
              </li>
            </ul>
            <p>
              Read the live values from <Code>api.consts.referenda.tracks</Code>.
              The lifecycle progress bar on each proposal mirrors them.
            </p>
          </Section>

          <Section
            id="cancellation"
            title="Cancellation paths"
            icon={<XOctagon />}
          >
            <p>
              A proposer cannot dispatch <Code>referenda.cancel(idx)</Code>{" "}
              themselves - it&apos;s gated to{" "}
              <Code>ReferendumCanceller</Code>. The realistic levers:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Don&apos;t place the decision deposit</strong> -
                the referendum times out after the prepare period. Deposits
                refund.
              </li>
              <li>
                <strong>Self-NAY</strong> - vote against your own
                proposal with high conviction. Only on-chain action that
                actually shifts the tally.
              </li>
              <li>
                <strong>File a cancellation referendum</strong> - a
                separate proposal on a privileged track that dispatches{" "}
                <Code>referenda.cancel(idx)</Code> if it passes. Heavy and
                rarely justified.
              </li>
              <li>
                <strong>Off-chain withdrawal</strong> (this app) - the
                Withdraw button sets <Code>withdrawn_at</Code>{" "}and surfaces a
                banner. Doesn&apos;t change on-chain state, but tells voters
                clearly to vote NAY.
              </li>
            </ul>
          </Section>

          <Section id="content-policy" title="Content policy & moderation" icon={<ShieldCheck />}>
            <p>
              Proposals, images and comments are public. These aren&apos;t allowed:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Secrets:</strong> wallet recovery phrases, private keys or
                screenshots showing them - anyone could take the funds.
              </li>
              <li>
                <strong>Personal data</strong> of others: ID documents, home addresses,
                phone numbers, private photos.
              </li>
              <li>
                <strong>Scams and phishing:</strong> fake airdrops, impersonation, links
                that ask for a wallet signature or seed.
              </li>
              <li>
                <strong>Sexual or violent</strong> content, and harassment or hate.
              </li>
              <li>Illegal content and spam.</li>
            </ul>
            <p>
              <strong>How it works.</strong>{" "}Anyone signed in can report a proposal
              (the &quot;…&quot; menu on its About card), an image (in the image
              viewer) or a comment. Moderators review reports in one queue and can
              keep, blur, hide or restore content; only admins can delete a file, for
              legal takedowns, or pause someone&apos;s posting. Every decision needs a
              reason and appears in the{" "}
              <Link href="/moderation-log" className="text-primary hover:text-purple-dim">
                public moderation log
              </Link>
              . Proposers can remove their own attachments at any time.
            </p>
            <p>
              <strong>Automatic checks</strong>{" "}(when enabled): uploaded images and
              PDFs are checked by an AI model (Anthropic&apos;s Claude) before they
              are stored. Clear violations, such as a readable recovery phrase, are
              rejected or held, depending on the admins&apos; setting; borderline
              files are held back and sent to the moderators&apos; queue, and appear
              once a moderator has looked. Animated images are judged by their first
              frame. Proposal text and comments are only ever flagged for a human -
              the machine never hides text on its own. Admins choose the model, what
              is checked and a daily limit; past the limit, content is posted
              unchecked and moderated by reports as usual.
            </p>
            <p>
              <strong>What moderation never does:</strong>{" "}nobody can rewrite someone
              else&apos;s text, and referenda, votes and on-chain records are never
              touched. A proposal&apos;s <Code>proposal.json</Code>{" "}stays byte-identical,
              so its EGOV1 verification keeps working even when an image is hidden or
              removed. Hidden images are no longer served by this site; deleted files
              are removed from storage itself. Older proposals may still link straight
              to the storage bucket, where a hidden (not deleted) file stays
              reachable - legal takedowns therefore use &quot;delete file&quot;.
            </p>
          </Section>

          <Section id="links" title="Links">
            <ul className="space-y-2">
              <li>
                <ExtLink href="https://wiki.polkadot.network/docs/learn-opengov">
                  Polkadot OpenGov reference
                </ExtLink>{" "}
                - the SDK pallets this client wraps.
              </li>
              <li>
                <ExtLink href="https://docs.enjin.io">
                  Enjin developer docs
                </ExtLink>{" "}
                - broader platform reference.
              </li>
              <li>
                <FoundABugModal />{" "}
                - report an issue or send feedback directly; the modal stays on
                this page so you don&apos;t lose your spot.
              </li>
              <li>
                <Link href="/security" className="text-primary hover:text-purple-dim">
                  Report a security issue
                </Link>{" "}
                - private vulnerability disclosures, kept off public channels
                until resolved.
              </li>
            </ul>
          </Section>
        </div>
      </main>
      <Footer />
    </div>
  )
}

function TableOfContents() {
  const entries: Array<[string, string]> = [
    ["overview", "What this is"],
    ["lifecycle", "How a proposal flows"],
    ["egov1", "EGOV1 metadata standard"],
    ["editing", "Editing & withdrawal"],
    ["voting", "Voting & conviction locks"],
    ["verification", "Verification"],
    ["wallets", "Wallet integration"],
    ["identity", "Identity & comments"],
    ["chain-coordinates", "Chain coordinates"],
    ["timing", "Timing primitives"],
    ["cancellation", "Cancellation paths"],
    ["links", "Links"],
  ]
  return (
    <nav
      aria-label="Contents"
      className="rounded-2xl bg-card border border-border p-5 sm:p-6"
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
        Contents
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {entries.map(([id, label]) => (
          <li key={id}>
            <Link
              href={`#${id}`}
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors"
            >
              <ArrowRight className="w-3 h-3" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Section({
  id,
  title,
  icon,
  children,
}: {
  id: string
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-28 space-y-3">
      <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
        {icon && (
          <span className="w-7 h-7 rounded-lg bg-primary/15 border border-purple-border flex items-center justify-center text-primary [&_svg]:w-4 [&_svg]:h-4">
            {icon}
          </span>
        )}
        {title}
      </h2>
      <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
        {children}
      </div>
    </section>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1 py-0.5 rounded bg-surface-2 text-[0.9em] font-mono text-foreground break-words">
      {children}
    </code>
  )
}

/**
 * Visual sample of the EGOV1 source badge as it actually renders on a
 * proposal's About card. Kept structurally identical to the live chip
 * in components/governance/proposal-metadata-header.tsx so the docs
 * stay a faithful colour reference if the chip gets restyled.
 */
function SourceBadgeSample({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium whitespace-nowrap shrink-0 mt-0.5 ${tone}`}
    >
      <FileJson className="w-3 h-3" />
      {label}
    </span>
  )
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="rounded-lg bg-surface-2 border border-border p-3 text-[11px] font-mono leading-relaxed text-foreground overflow-x-auto whitespace-pre">
      {children}
    </pre>
  )
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-primary hover:text-purple-dim underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  )
}

function ExtLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-primary hover:text-purple-dim"
    >
      {children}
      <ExternalLink className="w-3 h-3" />
    </a>
  )
}

/**
 * One per-network reference card under "Chain coordinates". Reads the
 * config straight from `lib/chain/chains.ts` so RPCs, SS58, treasury,
 * and CAIP-2 never drift from what the rest of the app actually uses.
 */
function ChainCard({
  chainId,
  tone,
}: {
  chainId: "enjin-relay" | "canary-relay"
  tone: "primary" | "testnet"
}) {
  const c = CHAINS[chainId]
  const accent =
    tone === "testnet"
      ? "border-amber-500/30 bg-amber-500/5"
      : "border-purple-border/40 bg-primary/5"
  const accentText =
    tone === "testnet" ? "text-amber-400" : "text-primary"
  return (
    <div className={`rounded-xl border ${accent} p-4 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{c.name}</p>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider ${accentText}`}
        >
          {tone === "testnet" ? "Testnet" : "Mainnet"}
        </span>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-muted-foreground">RPC</dt>
        <dd className="font-mono text-foreground break-all">{c.rpc}</dd>
        <dt className="text-muted-foreground">SS58 prefix</dt>
        <dd className="font-mono text-foreground">
          {c.ss58Prefix} (
          {chainId === "enjin-relay" ? "en…" : "cn…"})
        </dd>
        <dt className="text-muted-foreground">Decimals</dt>
        <dd className="font-mono text-foreground">{c.decimals}</dd>
        <dt className="text-muted-foreground">Ticker</dt>
        <dd className="font-mono text-foreground">{c.ticker}</dd>
        <dt className="text-muted-foreground">Treasury</dt>
        <dd className="font-mono text-foreground break-all">
          {c.treasuryAddress}
        </dd>
        <dt className="text-muted-foreground">CAIP-2</dt>
        <dd className="font-mono text-foreground break-all">
          {c.caip2.replace(/^polkadot:/, "")}
        </dd>
      </dl>
    </div>
  )
}

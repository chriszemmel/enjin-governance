<p align="center">
  <img src="public/brand/enjin-mark.svg" alt="Enjin" width="220" />
</p>

<h1 align="center">Enjin Governance</h1>

<p align="center">
  Production-grade web client for <a href="https://docs.enjin.io/">Enjin OpenGov</a>.<br/>
  Browse referenda, cast conviction votes, file treasury requests, comment,
  and manage a profile - all from the browser, all backed by live chain RPC.
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Polkadot.js" src="https://img.shields.io/badge/Polkadot.js-16-e6007a?style=flat-square&logo=polkadot&logoColor=white" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-330%20passing-22c55e?style=flat-square" />
</p>

<p align="center">
  <a href="https://enjin-governance.vercel.app">Live (Vercel)</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/GOVERNANCE_FLOW.md">Governance flow</a>
</p>

---

## Highlights

### Read the chain

- **Live chain reads** - referenda, tracks, tally, deposits, preimages
  streamed from Enjin's primary RPC plus a dedicated archive endpoint
  (`wss://archive.relay.{blockchain,canary}.enjin.io`) for historical
  state. Four-tier proposal-call sourcing: live state → archive
  history → on-chain `preimage.preimageFor` (with `len`-recovery scan) →
  Subscan enrichment as a last-resort fallback. Canary works with zero
  Subscan dependency.
- **Chain-sourced voter list** - every voter on a referendum read from
  `convictionVoting.votingFor.entries()` (per-vote currency pulled from the
  multi-token vote storage for ENJ vs sENJ pools), via the archive RPC at
  `finalisation_block - 1` for terminal refs. No indexer in the loop.
- **Participation graph** - stacked aye/nay distribution bar where each
  voter is one segment proportional to their conviction-weighted power,
  plus a conviction histogram showing how the vote was spread across
  the 0.1x-6x tiers. "One whale or many holders" at a glance.
- **Lifecycle progress** - visual prepare/decide/confirm timeline,
  decision-deposit awaiting state, time-elapsed badges.
- **Conviction voting** - lock periods compute from the live track's
  decision period; never hardcoded.

### Write to the chain

- **Multi-wallet** - Enjin Wallet (WalletConnect QR / mobile deep link),
  generic WalletConnect, plus the four major Polkadot browser extensions
  (Polkadot.js, Talisman, SubWallet, PolkaGate). Uninstalled wallets are
  greyed out with a one-click install link. Account picker shown on
  connect when the session carries more than one account, so a
  multi-account wallet never silently binds to the first account.
- **Real signing** - `useExtrinsic` wraps build → sign → broadcast →
  finalise with toast progress and human-readable module-error decoding.
  Routes governance calls through the runtime's multi-token `convictionVoting`
  fork (with a `voteManager` fallback for chains that expose it), probing
  metadata for the right call arity so the per-vote `currency` arg is never
  dropped.
- **Unified sign-request UX** - every signature (vote, treasury submit,
  sign-in) flows through the same modal that the connect QR uses, so
  WalletConnect sessions never get a stale prompt and the wake/redirect
  always targets the right peer. Sign-request TTL capped at 120s.
- **Treasury proposals end to end** - create wizard batches `preimage.notePreimage`
  + `referenda.submit` + `preimage.notePreimage(envelope)` +
  `referenda.setMetadata` via `utility.batchAll`. The referendum's
  `MetadataOf` binding carries an `EGOV1:{"u":"…","h":"…"}` envelope so any
  third party can rebuild the proposal corpus by resolving it through the
  preimage pallet. Auto-picks the smallest origin tier that covers the amount (capped
  at BigSpender / 1,000,000 ENJ); the beneficiary can be any address, and the
  enactment moment is selectable (as-soon-as-possible / delay / at a block).
- **General + admin proposals** - a separate `/create/advanced` composer files
  any proposal under a chosen track origin: cancel / kill a referendum,
  whitelist a call, authorize a runtime upgrade by wasm hash
  (`system.authorizeUpgrade`), on-chain remark, or a raw SCALE call. Small
  calls ride inline; larger ones are noted as a preimage automatically. An
  optional title / summary / body is anchored with the same EGOV1
  `setMetadata` binding as treasury proposals.
- **Delegation** - delegate conviction-weighted ENJ on one track or batch
  across all eligible tracks in a single signature, and undelegate per track.
- **Account governance state** - reclaim reserved deposits (submission /
  decision / preimage) and free conviction locks from `/account`.
- **Resumable drafts** - proposal JSON + media land in R2 before the
  user signs anything. If they bail out, the wizard offers to resume,
  edit, or delete the draft on `/account`. Drafts can be submitted
  later with the same confirmation flow as a fresh proposal.

### Identity + community

- **Sign-in by signature** - SIWE-style nonce flow against
  `signRaw`. No password, no transaction, no fee - the signature only
  proves you control the connected address. Session is httpOnly +
  rotating, gated by a Neon `wallet_sessions` table.
- **Profiles** - display name, `@handle`, bio, 150×150 avatar (R2 with
  content-type sniffing). Avatar fallback is a deterministic colour
  block from the SS58. Public read at `/user/<address>`.
- **Comments per proposal** - threaded, soft-deletable, stored in Neon.
  Show the proposer's profile (when signed in as themselves), the
  voter's profile, or fall back to the SS58.

### Pages

- **`/proposals`** - list with text search + status filter (All /
  Active / Approved / Rejected / Cancelled / Timed out). Cards show
  tally split-bar, track badge, lifecycle stage.
- **`/proposals/[index]`** - full detail page: treasury-request
  summary card when the call is `treasury.spend_local`, address links
  on every account reference (SS58 / hex pubkey re-encoded to the
  chain's prefix), votes list with profile enrichment, participation
  graph, votes swiper, vote panel, decision/submission deposit cards.
- **`/treasury`** - live treasury balance + ENJ/USD price (CoinGecko),
  per-tier reference, list of active treasury referenda only (filtered
  by canonical track name, so PascalCase / snake_case runtime variants
  both match).
- **`/create`** - 3-step treasury wizard (Create → Review → Submit).
  Surfaces unfinished drafts at the top so the proposer can pick up where
  they left off. Beneficiary, enactment timing, and decision-deposit
  placement are all in the flow.
- **`/create/advanced`** - general + admin proposal composer: cancel /
  kill a referendum, whitelist a call, authorize a runtime upgrade (hash
  computed in the browser from the `.wasm`), on-chain remark, or a raw SCALE
  call, under a chosen track origin (inline vs preimage chosen automatically
  by call size), with optional EGOV1 metadata.
- **`/account`** - profile editor with **Sign out** in destructive red,
  a "Your proposals" panel (**Live / Drafts / Cancelled** filters,
  **Edit / Submit / Delete**), plus governance state: **Delegation**
  (delegate per track or all tracks at once, and undelegate), **Locked
  balance** (free expired conviction locks), and **Reserved deposits**
  (reclaim submission / decision / preimage deposits).
- **`/security`** - public security-disclosure form (no account required);
  reports persist to the DB and optionally fan out to Telegram. IP
  rate-limited and honeypot-guarded against bot spam.
- **`/user/[address]`** - public profile + voting history.
- **`/unlock`** - claims expired conviction locks.

### Infra

- **In-app network switcher** - flip Canary ↔ Mainnet at runtime, no
  redeploy. Choice persists to localStorage.
- **Subscan-aware caching** - every server route honours Subscan's 5
  req/s rate ceiling: terminal-status responses cached at the CDN for
  24h (immutable), ongoing for 5 min. React Query staleTime matches.
- **Polished loading** - page-shaped skeleton geometry for the
  proposal list, detail page, and inline preimage / votes loading.
  No layout shift when real data arrives.
- **Friendly errors** - `friendlyError()` turns RPC failures into
  one-line cards with a Retry button.
- **Dark + light themes** - Enjin purple, OKLch-tokenized, WCAG AA.
- **Abuse protection** - per-IP / per-user fixed-window rate limits on
  every write + auth endpoint (429 + `Retry-After`), a brute-force ceiling
  on the site-access password gate, input-size caps on the batch-read
  endpoints, and a honeypot on the public disclosure form that silently
  drops bots.
- **Open-source ready** - TS strict, ESLint clean, knip-clean, 330
  vitest tests, CI on every push.

---

## By the numbers

| | |
|---|---|
| TypeScript source files (excl. vendored shadcn) | **~218** |
| Docs files | **6** |
| Unit tests | **330** (29 files) |
| Wallets supported | **6** (Enjin Wallet · generic WalletConnect · Polkadot.js · Talisman · SubWallet · PolkaGate) |
| Chains configured | **4** - 2 live (Enjin + Canary **Relay**, OpenGov) plus 2 rails-only (Enjin + Canary **Matrix**, legacy `democracy` pallet, not yet integrated). Dedicated archive RPCs per chain. |
| External indexer dependencies | **0 required** (Subscan optional, only for very old finalised refs) |
| Off-chain stores | **Neon Postgres** (users, sessions, profiles, comments, proposals, attachments, security disclosures) · **Cloudflare R2** (avatars, proposal JSON, proposal media) |

---

## Quick start

```bash
git clone https://github.com/chriszemmel/enjin-governance-closed.git
cd enjin-governance-closed
nvm use            # Node 22 (or check .nvmrc)
pnpm install
cp .env.example .env.local
pnpm dev           # http://localhost:3000
```

That's enough for browsing. Defaults work without **any** env vars -
extension wallets connect immediately and every read flows from the
public RPC. For the full feature set:

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` enables Enjin Wallet + generic
  WalletConnect (free from <https://cloud.reown.com>).
- `DATABASE_URL` (Neon pooled) enables sign-in, profiles, comments,
  proposal drafts.
- `R2_*` enables avatar uploads, proposal JSON, proposal media.

See **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** and
**[`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)** for the deploy and env setup.

---

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19 | Server components by default; client where state is needed |
| Styling | Tailwind CSS 4 + shadcn/ui | OKLch tokens, dark + light variants |
| Chain SDK | `@polkadot/api` | Wrapped behind `lib/chain/*` - swap to papi later is a 1-day job |
| Wallets | WalletConnect v2 + `@polkadot/extension-dapp` | Connector pattern in `lib/wallet/connectors/*` |
| Auth | SIWE-style `signRaw` nonce → httpOnly session | `lib/auth/siwe.ts` + `/api/auth/*` |
| Data | TanStack Query + chain archive RPC + CoinGecko | RPC is canonical (incl. archive endpoints for historical state); Subscan is an optional enrichment fallback; CoinGecko prices ENJ |
| Off-chain DB | Neon Postgres | Users, sessions, profiles, comments, proposals, attachments, security disclosures |
| Object storage | Cloudflare R2 (S3-compatible) | Avatars, proposal JSON (`EGOV1` envelope), proposal media |
| State | Zustand | Wallet session + active chain |
| Validation | Zod + `@t3-oss/env-nextjs` | `lib/env.ts` is the single source of truth |
| Tests | Vitest | Pallet + chain primitives + auth + format helpers |
| CI | GitHub Actions | typecheck + lint + knip + test + build on every push |

---

## Scripts

```bash
pnpm dev          # Next.js dev server
pnpm build        # Production build
pnpm start        # Production server

pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
pnpm lint:fix     # ESLint --fix
pnpm format       # Prettier --write
pnpm knip         # Find dead code / unused deps
pnpm test         # Vitest (330 tests)
pnpm test:watch   # Vitest watch
```

---

## Project structure

```
app/                   Next.js routes (live RPC reads via React Query)
  account/             Profile editor + drafts list with filters + actions
  create/              3-step proposer wizard (Create → Review → Submit)
  proposals/           List + detail page
  treasury/            Live balance + treasury-tier referenda
  unlock/              Conviction-lock claim flow
  user/[address]/      Public profile + voting history
  api/auth/            Nonce + verify + me + logout (SIWE-style; rate-limited)
  api/proposals/       Draft (R2 + DB), confirm, cancel, withdraw, edit/delete,
                       comments, by-index, by-indices, by-proposer, media, json
  api/users/           me, by-address/[address], by-addresses, me/avatar
  api/security-disclosures/  Public report intake (rate-limited + honeypot)
  api/unlock/          Site-access password gate (rate-limited)
  api/subscan/         Server proxies (referendum / preimage / votes).
                       Honour Subscan's 5 req/s ceiling with CDN cache
                       headers and structured Vercel logs.
components/
  layout/              Nav, footer, theme toggle, network switcher, brand
  governance/          ProposalCard, TallyBar (split-bar + detail variants),
                       TrackBadge, VotePanel, PreimageDisplay,
                       LifecycleProgress, ParticipationGraph, VotesList,
                       VoteDetailModal, TallyVotesSwiper, AddressLink,
                       BlockTime, skeletons
  create/              CallCard, AttachmentDropzone, MyDraftsPanel
  wallet/              WalletModal (with account picker on connect),
                       SignRequestModal (unified for every signature),
                       BrandedQr (module-snapped logo cutout)
  account/             Avatar
  ui/                  shadcn primitives (vendored)
lib/
  chain/               ApiPool, SS58 (incl. hex-pubkey → SS58 encoder),
                       formatters, event matchers, chain registry with
                       dedicated archive RPC URLs per chain
  governance/          Referenda + conviction-voting (incl. listVotesOnPoll)
                       + preimage (with `len` recovery + key scan)
                       + treasury + tracks (canonicalTrackName for
                       PascalCase/snake_case parity) + status decoders +
                       call-extract (treasury-spend intent normaliser) +
                       vote-decode (vote byte + currency) + lifecycle +
                       proposal-metadata (EGOV1 schema) +
                       submit-treasury-proposal (batch builder) +
                       first-statement (auto-fill template)
  wallet/              Connectors (WC with sessionProperties / peerMetadata
                       name extraction + extension), registry, store,
                       signer adapter, deep-link builder
  auth/                SIWE-style nonce/verify, current-user cookie reader,
                       site-password gate
  security/            Disclosure schema + honeypot check + Telegram notify
  rate-limit.ts        Fixed-window limiter (pure core + in-process store)
  db/                  Neon client + users, sessions, profiles, comments,
                       proposals, attachments, security-disclosures
  r2/                  S3 client + avatar/json/media upload helpers +
                       key-path conventions
  query/               React Query client + hooks (use-api / -archive-api /
                       -referenda / -referendum / -referendum-history /
                       -referendum-votes (chain-sourced) / -tracks /
                       -balance / -tx / -current-block / -preimage /
                       -subscan-* / -token-price / -session / -profile /
                       -my-drafts / -comments)
  subscan/             Server-side Subscan API wrapper (referendum + votes +
                       preimage endpoints, with normaliseSubscanCall to
                       handle Subscan's varying response shapes and a
                       masked-key Vercel logger for diagnosing failures)
  og/                  Shared OpenGraph card renderer for the per-route
                       opengraph-image.tsx files (next/og)
  env.ts               t3-env zod schema
  config.ts            App constants
docs/                  ARCHITECTURE · CHAIN_FLOW · GOVERNANCE_FLOW ·
                       WALLET_INTEGRATION · ENVIRONMENT · DEPLOYMENT ·
                       HANDOVER
scripts/               SQL migrations (004-010) + run-migrations.mjs
.github/workflows/     CI
```

---

## The EGOV1 metadata standard

Every treasury proposal filed through this app batches four calls
into a single signed extrinsic (`/create/advanced` proposals with details
attached use the same binding - see
[GOVERNANCE_FLOW](docs/GOVERNANCE_FLOW.md#write-flow-advanced-proposals)):

```text
utility.batchAll([
  preimage.notePreimage(<treasury.spendLocal call bytes>),
  referenda.submit(<track origin>, Lookup{hash, len}, <enactment>),
  preimage.notePreimage('EGOV1:{"u":"<json url>","h":"<sha256>"}'),
  referenda.setMetadata(<index>, blake2_256(<envelope bytes>)),
])
```

`<enactment>` defaults to `After 0` (as soon as possible after passing) but is
selectable in the wizard (a block delay or a fixed `At` height).
`<index>` is `referenda.referendumCount()` read at build time - the index
`referenda.submit` is about to mint. If another submission lands first the
index is stale, `setMetadata` fails the runtime's depositor check
(`NoPermission`), and the whole batch reverts - a stale index can never
annotate someone else's referendum; the wizard rebuilds and retries.

The `EGOV1:` envelope is a content-addressed backlink to the off-chain
JSON proposal stored in R2, bound to the referendum through
`referenda.metadataOf(index)`. Anyone - Polkassembly, Subscan, a
third-party indexer, or another client - can rebuild the proposal corpus
by reading `MetadataOf`, resolving the hash through the `preimage`
pallet, filtering for the `EGOV1:` magic prefix, and fetching the URL.
Generic tooling renders the binding natively.

Referenda filed before the `setMetadata` anchor shipped carry the same
envelope as a `system.remark` call inside the submission
`utility.batchAll` - indexers should check `MetadataOf` first and fall
back to remark-scanning for those.

The off-chain JSON is the source of truth for the human-readable
title / summary / body / attachments / preimage hash. The on-chain
binding just pins it.

---

## Documentation

Start with **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** for the big
picture.

| Doc | What it covers |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Layer boundaries, data flow, dependency graph |
| [CHAIN_FLOW](docs/CHAIN_FLOW.md) | How RPC connection, retry, and fallback work (incl. archive RPCs) |
| [GOVERNANCE_FLOW](docs/GOVERNANCE_FLOW.md) | OpenGov primer + the read / write / batchAll flows |
| [WALLET_INTEGRATION](docs/WALLET_INTEGRATION.md) | Connector pattern + WC + extensions + signer adapter |
| [ENVIRONMENT](docs/ENVIRONMENT.md) | Every env var, what it does, when it's required |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Vercel + Neon + R2 + Reown setup |
| [HANDOVER](docs/HANDOVER.md) | Maintainer handover: secrets inventory, off-chain data export, accounts to transfer, sunset plan |
| [SECURITY](SECURITY.md) | Reporting a vulnerability, security model, operator hardening |

The off-chain schema lives in `scripts/0*.sql` (forward-only, applied
via `pnpm db:migrate`).

---

## Vercel deploy

The minimum:

```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<32-char hex from cloud.reown.com>
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

Recommended for the full feature set:

```
DATABASE_URL=<Neon pooled connection>        # sign-in, profiles, comments, drafts
R2_ACCOUNT_ID=<cloudflare account id>        # avatars, proposal JSON, media
R2_ACCESS_KEY_ID=<r2 token>
R2_SECRET_ACCESS_KEY=<r2 secret>
R2_BUCKET=<bucket name>
R2_ENDPOINT=<https://<account-id>.r2.cloudflarestorage.com>
R2_PUBLIC_URL=<https://<your bucket>.r2.dev or custom domain>
NEXT_PUBLIC_DEFAULT_NETWORK=canary-relay     # or "enjin-relay" for mainnet
```

Optional:

```
SUBSCAN_API_KEY=<from pro.subscan.io>        # decodes call data for very old finalised refs
```

In Reown Cloud → **Allowed Domains**: add your production domain.
Apply `scripts/0*.sql` to the Neon project (or run `pnpm db:migrate`).
Full guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Networks

| Network | RPC | SS58 | Ticker | Status |
|---|---|---|---|---|
| Enjin Relaychain | `wss://rpc.relay.blockchain.enjin.io` | 2135 (`en…`) | ENJ | **Primary** |
| Canary Relaychain | `wss://rpc.relay.canary.enjin.io` | 69 (`cn…`) | cENJ | **Default for canary testing** |
| Enjin Matrixchain | `wss://rpc.matrix.blockchain.enjin.io` | 1110 (`ef…`) | ENJ | Rails only - legacy `democracy` pallet, not OpenGov |
| Canary Matrixchain | `wss://rpc.matrix.canary.enjin.io` | 9030 (`cx…`) | cENJ | Rails only - legacy `democracy` pallet, not OpenGov |

Treasury (Relay): `enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA`
Community wallet (Matrix multisig): `efRd63tR845wJ4FxoUfFgrDpxfAQ2t1iydU7LyzJCf577hgTH`

The two Matrixchains are in the chain registry (RPC, SS58, archive RPC,
treasury address) but ship `enabled: false`. They run Substrate's legacy
`democracy` pallet plus `council` / `technicalCommittee` collectives - not the
OpenGov stack (`referenda` + `convictionVoting`) this client is built around
(confirmed live against the `matrix-enjin` runtime, spec 1031). Matrix
governance is therefore a separate integration - a `democracy`-pallet read /
write surface - rather than a config flip, and a natural future expansion for
the ecosystem.

---

## Contributing

1. Branch from `main`.
2. Make changes following the existing module conventions.
3. Run `pnpm typecheck && pnpm lint && pnpm knip && pnpm test && pnpm build` -
   all must pass.
4. Open a PR. CI runs the same checks.

For substantial changes (new pallet, new write flow, new architecture layer),
open an issue first to align on approach.

---

## License

[AGPL-3.0-or-later](LICENSE). Copyright (C) 2026 Chris Zemmel.

If you run a modified version of this software to provide a network service,
the AGPL requires you to offer that modified source to its users. For
commercial terms outside the AGPL, contact the copyright holder.

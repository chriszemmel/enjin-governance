# Architecture

> Read this first. It explains where code runs, how `lib/` is layered, what
> each module owns, and how data moves between the browser, the API routes,
> the chain and storage.

## Where code runs

| Place | What runs there | Talks to |
|---|---|---|
| Browser | Interactive pages (`"use client"`), `components/`, `lib/query` hooks, wallet connectors | Chain RPC over WebSocket, the app's API routes, wallets, CoinGecko, NFT metadata hosts |
| `proxy.ts` | CSRF check and site password gate, before every request except static files | Nothing outside the app |
| Route handlers | `app/api/**/route.ts`, `app/r/[...key]/route.ts` | Neon Postgres, Cloudflare R2, chain RPC, Subscan, Telegram, Anthropic API |
| Server components | Root layout, `/docs`, `/imprint`, `/privacy`, `/terms`, OpenGraph images (edge) | Env vars only |

Chain data is read in the browser. The server reads the chain only before
it acts on a proposal: to check whether a draft's envelope is on chain,
whether a referendum belongs to a draft, and whether it is still open for
edits.

## Layer diagram: browser

```
┌──────────────────────────────────────────────────────────────────────┐
│  app/ (pages) + components/                                          │
│  ──────────────────────────                                          │
│  Renders UI and local state. Reads through lib/query hooks. Writes   │
│  to the chain through useExtrinsic, off chain through app/api/**.    │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────────────────────┐
│  lib/query/                                                          │
│  ──────────                                                          │
│  React Query client, key factory and hooks. Chain reads, API reads   │
│  and useExtrinsic (build → sign → broadcast → watch → invalidate).   │
└──────────┬──────────────────────┬──────────────────────┬─────────────┘
           │                      │                      │
┌──────────▼─────────┐ ┌──────────▼─────────┐ ┌──────────▼─────────────┐
│ lib/governance/    │ │ lib/wallet/        │ │ fetch → app/api/**     │
│ ────────────────── │ │ ────────────────── │ │ ────────────────────── │
│ Pallet readers,    │ │ Connectors, store, │ │ Off-chain data. See    │
│ batch builders,    │ │ signer, sign-in    │ │ the server diagram     │
│ EGOV1, decoders.   │ │ prompts.           │ │ below.                 │
└──────────┬─────────┘ └──────────┬─────────┘ └────────────────────────┘
           │                      │
┌──────────▼──────────────────────▼────────────────────────────────────┐
│  lib/chain/                                                          │
│  ──────────                                                          │
│  Chain registry, connection pool, SS58, formatting, event helpers,   │
│  active-chain store. Knows nothing about governance or storage.      │
└──────────────────────────────────────────────────────────────────────┘
```

## Layer diagram: server

```
  request
    │
  proxy.ts                   CSRF same-origin check on /api writes,
    │                        site password gate when enabled
    ▼
  app/api/**/route.ts        checks input, session, ownership, posting
  app/r/[...key]/route.ts    pause and rate limit, then does its work
    │
    ├── lib/auth/            sessions, SIWE, roles, CSRF, password gate
    ├── lib/db/              Neon SQL, one module per table group
    ├── lib/r2/              bucket client, uploads, key layout, images
    ├── lib/governance/      server-only: draft-versions, envelope-status,
    │                        attachment-check
    ├── lib/moderation/      policy, automatic checks, settings, notices
    ├── lib/subscan/         Subscan API wrapper
    ├── lib/telegram/        best-effort chat notices
    ├── lib/rate-limit.ts    fixed-window limits (shared KV or in-process)
    └── lib/chain/           getApi, for on-chain checks only
```

## Module map

| Module | Runs on | Owns |
|---|---|---|
| `lib/chain/` | Both | Chain registry (`chains.ts`), connection pool (`api.ts`), primary→fallback helper (`connect.ts`), SS58 (`ss58.ts`), amounts and block times (`format.ts`), event and dispatch-error helpers (`events.ts`), active-chain store (`use-chain.ts`, browser) |
| `lib/governance/` | Both | Pallet readers and builders over an `ApiPromise` (referenda, preimage, conviction voting, tracks, treasury, deposits, staking pools, multi-tokens), batch builders (`submit-treasury-proposal.ts`, `proposal-batch.ts`, `proposal-calls.ts`, `enactment.ts`), the EGOV1 schema (`proposal-metadata.ts`), display, Markdown, media and lifecycle helpers. Server only: `draft-versions.ts`, `envelope-status.ts`, `attachment-check.ts`. Browser only: `confirm-client.ts` |
| `lib/query/` | Browser | React Query client (`client.ts`), provider, key factory (`keys.ts`), hooks in `hooks/` |
| `lib/wallet/` | Browser | Connectors (WalletConnect, browser extensions), registry, zustand store, `useWallet`, sign-request modal state, `useEnsureSignedIn`, session restore |
| `lib/auth/` | Server | SIWE message and signature check (`siwe.ts`), session cookie reader (`current-user.ts`), moderation roles (`roles.ts`), CSRF check (`csrf.ts`), handle rules (`handle-blocklist.ts`). `site-password.ts` is pure and shared with `proxy.ts` and `/unlock` |
| `lib/db/` | Server | Neon SQL: users, sessions, nonces, proposals and attachments, comments, moderation, security disclosures |
| `lib/r2/` | Server | S3 client for R2, uploads and reads (`upload.ts`), image cleanup (`media-processing.ts`, `avatar.ts`). Pure and shared: key layout (`paths.ts`), stable JSON (`json.ts`), magic-byte sniffing (`sniff.ts`) |
| `lib/moderation/` | Server | Automatic checks (`scan.ts`, `auto-flag.ts`), check settings (`settings-store.ts`), posting pauses, target lookup, report notices. Pure and shared: `policy.ts`, `scan-settings.ts` |
| `lib/uploads/` | Both | The 4 MB upload limit (`limits.ts`) and in-browser shrinking of large photos (`fit-for-upload.ts`) |
| `lib/rate-limit.ts` | Server | Fixed-window limiter and the `RATE_LIMITS` table |
| `lib/subscan/` | Server | Subscan API wrapper for the `app/api/subscan/*` routes |
| `lib/telegram/` | Server | `sendTelegramMessage` |
| `lib/security/` | Both | Disclosure form schema (pure) and its Telegram notice (server) |
| `lib/legal/` | Server | `getOperator()`: the operator's details from `LEGAL_*`, for `/imprint`, `/privacy` and `/terms` |
| `lib/og/` | Server (edge) | OpenGraph card renderer for the `opengraph-image.tsx` routes |
| `lib/utils/`, `lib/utils.ts` | Both | Error text (`format-error.ts`, `api-error.ts`), safe redirects, `cn` |
| `lib/env.ts`, `lib/config.ts` | Both | Typed env vars; app name, title and description |

## Import rules

Only the first rule is enforced by the build. The others are kept by review.

1. **Server-only modules stay on the server.** Modules that touch the
   database, the bucket or a secret start with `import "server-only"`, so
   importing one into a client component fails the build. This covers
   `lib/db/**`, `lib/r2/{client,upload,media-processing,avatar}.ts`,
   `lib/auth/{siwe,current-user,roles}.ts`, `lib/moderation/**` except
   `policy.ts` and `scan-settings.ts`, `lib/telegram/**`,
   `lib/security/notify.ts`, `lib/legal/**`, and
   `lib/governance/{draft-versions,envelope-status,attachment-check}.ts`.
   Two server modules don't carry the marker: `lib/rate-limit.ts` (kept
   importable from tests) and `lib/subscan/client.ts` (the proposal page
   imports its pure `normaliseSubscanCall`).
2. **Pure modules are shared.** Modules without I/O are imported from both
   sides, for example `lib/r2/paths.ts`, `lib/r2/json.ts`,
   `lib/moderation/policy.ts`, `lib/uploads/**`, and most of
   `lib/governance/**` and `lib/chain/**`.
3. **The UI reads through hooks.** Pages and components get chain and API
   data from `lib/query` hooks. Direct `fetch` calls in the UI are kept to
   one-off requests (staging a draft, uploading media, the security and
   unlock forms) and to loading a proposal's JSON (resuming a draft, the
   edit page, and `proposal-metadata-header.tsx`, which also hashes it).
4. **Only `useExtrinsic` signs.** Components pass a `build(api)` closure,
   usually made from `lib/governance` builders. Signing, broadcasting and
   status tracking live in `lib/query/hooks/use-tx.ts` and nowhere else.
5. **`lib/chain` is the bottom layer.** Besides `@polkadot/*`, it imports
   only `lib/env`, plus `zustand` and React for the active-chain store.
6. **`lib/governance` has no React.** Its pure modules depend on `lib/chain`
   and `@polkadot/*`. The three server-only modules also use `lib/r2` and
   `getApi`. `call-extract.ts` imports one type from `lib/subscan`.
7. **`lib/wallet` and `lib/query` use each other's hooks.** `useExtrinsic`
   reads `useWallet`; `useEnsureSignedIn` uses the session hooks.
8. **`lib/og` is leaf code.** It depends on `next/og` only.

## Data flow: reading a referendum

```
  app/proposals/[index]/page.tsx
    ├── useReferendum(index)                   [lib/query/hooks/use-referendum.ts]
    │     └── getReferendum(api, index)        [lib/governance/referenda.ts]
    │           ├── api.query.referenda.referendumInfoFor(index)
    │           └── decodeReferendumInfo(index, raw)   [lib/governance/status.ts]
    ├── useReferendumHistory(index, at)        archive node, state at block at - 1
    ├── useSubscanReferendum(index)            GET /api/subscan/[chain]/referendum/[index]
    ├── usePreimage(ref), useSubscanPreimage(hash)
    ├── useReferendumVotes(index)              live, or archive at at - 1 once concluded
    └── useProposalMetadata(index)             GET /api/proposals/by-index/[index]
          └── ProposalMetadataHeader           JSON via /api/proposals/[uuid]/json,
                                               sha256 checked in the browser
```

A concluded referendum's on-chain record drops its tally, call and
submitted block. The page fills them from the archive node first and from
Subscan second. The call is decoded from `preimage.preimageFor` and falls
back to Subscan. [`CHAIN_FLOW.md`](CHAIN_FLOW.md) has the order and the
timings.

`ProposalMetadataHeader` hashes the canonical JSON (`stringifyStable`) with
SHA-256 and compares it with the row's `json_sha256`. Images load only from
the proposal's own media folder, through `/r`
(`resolveProposalMedia` in `lib/governance/proposal-media.ts`).

## Data flow: filing a proposal

```
  app/create/page.tsx (treasury wizard) · app/create/advanced/page.tsx (any call)
    ├── POST /api/proposals/[uuid]/media               once per attachment
    │     ├── 4 MB cap, sniffMediaMime                  [lib/uploads/limits.ts, lib/r2/sniff.ts]
    │     ├── processProposalImage                      [lib/r2/media-processing.ts]
    │     ├── checkUpload                               [lib/moderation/auto-flag.ts]
    │     └── putObject(proposals/{net}/{uuid}/media/…) [lib/r2/upload.ts]
    ├── POST /api/proposals/draft                      "Stage"
    │     ├── anyVersionOnChain (re-stage only)         [lib/governance/draft-versions.ts]
    │     ├── checkAttachments                          [lib/governance/attachment-check.ts]
    │     ├── putJson(proposals/{net}/{uuid}/proposal-{sha256 prefix}.json)
    │     └── insertProposalDraft | updateProposalDraft [lib/db/proposals.ts]
    ├── useExtrinsic({ resolveOn: "finalized", build }) [lib/query/hooks/use-tx.ts]
    │     └── utility.batchAll([
    │           preimage.notePreimage(<call>),          skipped if noted or inline
    │           referenda.submit(origin, Lookup | Inline, enactment),
    │           preimage.notePreimage('EGOV1:{"u":"…","h":"…"}'),  skipped if noted
    │           referenda.setMetadata(index, blake2_256(envelope)),
    │         ])
    └── on finalized: confirmWithRetry                  [lib/governance/confirm-client.ts]
          └── POST /api/proposals/[uuid]/confirm
                ├── metadataOf(index) = this draft's envelope (or an older version's)
                ├── depositor = proposer, call = the draft's preimage
                ├── attachReferendumIndex               [lib/db/proposals.ts]
                ├── putJson(proposals/{net}/index/{index}.json)
                └── flagText, after the response        [lib/moderation/auto-flag.ts]
```

- **Builders.** The treasury wizard uses `buildTreasuryProposal`
  (`lib/governance/submit-treasury-proposal.ts`). The advanced composer at
  `/create/advanced` builds the call with `buildProposalCall`
  (`proposal-calls.ts`) and the batch with `buildProposalBatch`
  (`proposal-batch.ts`). Calls of 128 bytes or less go inline, without a
  preimage. The composer can also attach an EGOV1 record to a referendum
  filed elsewhere (`attachMetadataToExisting`: the last two calls only). The
  runtime accepts that only from the referendum's depositor while it is
  ongoing.
- **The index.** `index` is `referenda.referendumCount()`, read right before
  signing. If another submission lands first, `setMetadata` fails with
  `NoPermission` and the whole batch reverts.
- **The envelope.** `EGOV1:{"u":"<url>","h":"<sha256>"}` is noted as its
  own preimage and bound with `referenda.setMetadata`. Anyone can resolve
  `referenda.metadataOf(index)` through the `preimage` pallet and fetch the
  JSON by URL and hash, without our database. Referenda filed before this
  anchor shipped carry the envelope as a `system.remark` in the submission
  batch; indexers fall back to scanning for those.
- **Schema versions.** The JSON uses schema `enjin-governance-proposal`
  1.1.0, or 1.2.0 when it carries the `call` and `enactment` sections that
  the advanced composer writes (`lib/governance/proposal-metadata.ts`).
- **Resumable drafts.** Every staged version of a draft's JSON is stored
  under its own hash-named key and is never overwritten, so a batch signed
  from an older version (another tab, a re-stage in flight) still points at
  the exact bytes it pinned (`lib/governance/draft-versions.ts`). Re-staging
  updates the same row, only by its proposer, only while it is still a
  draft, and only from the version the browser last saw
  (`expected_sha256`). Once any version's envelope is on chain, the draft
  can't be re-staged or deleted; it must be linked. Drafts staged before
  v1.1 use `proposal.json`.
- **Linking.** The confirm route fails closed and the browser retries it. If
  the batch was signed from an older version, the route finds that version
  (`versionWithMetadataHash`) and switches the draft back to it. A
  submission that landed but was never linked can be linked later from the
  drafts panel by index alone (`useLinkDraft` in
  `lib/query/hooks/use-my-drafts.ts`).
- **Attachments.** The 4 MB cap in `lib/uploads/limits.ts` applies in the
  browser and on the server. The browser shrinks large PNG, JPEG and WebP
  photos first (`fitForUpload`). The server takes the type from the file's
  magic bytes, removes image metadata, scales images to fit 2560 px and
  writes a WebP thumbnail. At staging, `checkAttachments` compares each
  attachment's name, size, type and hash with the stored file and refuses
  any mismatch.
- **Editing.** While the referendum is ongoing, the proposer can edit the
  title, summary, body and attachments (`PATCH /api/proposals/[uuid]`). The
  JSON is rewritten at the same key, so its hash no longer matches the
  on-chain envelope. That mismatch is the public sign of an edit. The call,
  amount and beneficiary can't change.

## Data flow: signing in (SIWE-style)

```
  useEnsureSignedIn / "Sign in" on /account      [lib/wallet/use-ensure-signed-in.ts]
    └── POST /api/auth/nonce     [per-IP limit, freshNonce + insertNonce → auth_nonces]
    └── signer.signRaw(message)  [the active connector's Signer]
    └── POST /api/auth/verify    [per-IP limit, consumeNonceRow (atomic DELETE … RETURNING),
                                  verifySignature, upsertUserByAddress,
                                  insertSession + HttpOnly cookie]
    └── GET  /api/auth/me        [getCurrentUser: cookie → sha256 → wallet_sessions]
```

The client side lives in `lib/query/hooks/use-session.ts` (`useNoncePrefetch`,
`useSignIn`, `useMe`). Nonces live in Postgres (`auth_nonces`, 30-minute
TTL), not in process memory: serverless instances don't share a heap, so an
in-memory map would lose the nonce between the two requests. Each sign-in
mints a new opaque token; only its sha256 is stored. Sessions expire after
30 days. Signing in has no chain side effects.

**One identity per network.** Each SS58 address is its own `users` row,
scoped by `network` (derived from the SS58 prefix). The same key on Enjin
Relay (`en…`) and Canary (`cn…`) is two separate users, so handles live in
per-network namespaces: `@chris` on Canary doesn't block `@chris` on Relay.
The network switcher disconnects the wallet on every change, so a session
only ever touches one chain. Ownership checks compare public keys
(`samePublicKey`), so they hold across prefixes.

## Data flow: serving stored files

`GET /r/[...key]` (`app/r/[...key]/route.ts`) serves R2 objects from the
app's own origin. The EGOV1 `u` pointer uses this route
(`publicAssetBase()` in `lib/r2/client.ts`), so the permanent link lives on
the app's domain, not the bucket's.

- Only keys under `proposals/` and `user-avatars/` are served
  (`isPublicReadableKey`).
- Proposal media is checked against its moderation state. Hidden, removed
  and automatically held files answer 404. Proposal JSON is never withheld.
- Responses carry `Access-Control-Allow-Origin: *`, so anyone can fetch and
  hash the JSON. Media is cached for 5 minutes, because a moderator may hide
  it later. JSON keeps the short cache it was written with.

## Moderation

- **Roles.** Admins come from `GOVERNANCE_ADMIN_PUBLIC_KEYS`. Admins grant
  moderator and admin roles in `/moderation`; those live in
  `moderation_roles`. Both are keyed by public key (`lib/auth/roles.ts`), so
  a role holds on every network.
- **Reports and decisions.** Users report proposals, attachments and
  comments (`POST /api/moderation/reports`). Moderators work the queue
  (`GET /api/moderation/queue`) and act (`POST /api/moderation/actions`):
  keep, blur, hide or restore. Admins can also delete files and pause
  someone's posting. Every action needs a reason and lands in the public log
  (`/moderation-log`).
- **Scope.** Moderation state lives in the database (`moderation_state`) and
  changes only what the app serves and shows. It never rewrites proposal
  JSON, so EGOV1 verification stays intact, and it never touches on-chain
  data.
- **Posting pauses.** Write routes that post content call
  `postingSuspendedResponse` (`lib/moderation/suspension.ts`).
- **Automatic checks.** Optional, and only with `ANTHROPIC_API_KEY` set.
  Uploads are checked before they are stored (`checkUpload`). Proposal text
  and comments are checked after the response is sent (`flagText`); a check
  can only add a queue entry, never hide text. The admin switches checks on,
  chooses what is checked, sets a daily limit and picks the model in
  Moderation → Settings, which lists the supported models and their prices.
  Settings live in `moderation_settings` and are cached for 30 seconds per
  instance. An API outage never blocks posting.
- **Telegram notices.** `lib/telegram/send.ts` posts best-effort messages
  with a 5-second timeout: new reports (`lib/moderation/notify.ts`) and new
  security disclosures (`lib/security/notify.ts`).

## Request pipeline on the server

`proxy.ts` (Next.js 16's replacement for `middleware.ts`) runs first:

1. `enforceSameOrigin` (`lib/auth/csrf.ts`) refuses a POST, PATCH, PUT or
   DELETE to `/api/*` whose `Origin` (or `Referer`) host isn't this site.
2. When `SITE_PASSWORD_STATUS=ON`, a request without a valid access cookie
   is redirected to `/unlock`. The gate lets through `/unlock`,
   `/api/unlock`, `/brand/*`, the legal pages, OpenGraph images, and social
   link previewers on non-API paths.

Write routes then check the input shape, a signed-in user
(`getCurrentUser`, 401), ownership by public key, a posting pause and the
rate limit (429 with `Retry-After`). The order varies a little between
routes.

- **Rate limits.** All ceilings live in `RATE_LIMITS` (`lib/rate-limit.ts`).
  Anonymous routes (sign-in nonce and verify, security disclosures, site
  unlock) are keyed per IP; signed-in writes per user; report notices share
  one global ceiling. With `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the
  Upstash names) the counters are shared through Upstash. Without KV, or when
  it fails, each instance counts in memory.
- **Missing config.** Routes answer 503 when the database or R2 isn't
  configured (`isDbConfigured`, `isR2Configured`).

## Tests

- Unit tests sit in `__tests__/` folders next to the modules they cover.
- `lib/__sec__/` holds route-level security tests. They import the real
  route handlers and `proxy.ts`, and replace only I/O: in-memory proposal
  tables (`fake-db.ts`), bucket (`fake-bucket.ts`) and moderation tables
  (`fake-moderation.ts`), plus mocks for auth, rate limits and the chain.
- `vitest.config.ts` runs `lib/**` tests in Node and stubs `server-only`
  with `test/server-only-stub.ts`.

## Source-of-truth rules

1. **The chain RPC is canonical.** Subscan, Neon, R2 and any future indexer
   are caches or enrichment, never sources of truth for on-chain state.
2. **`lib/env.ts` defines the env vars.** New variables go there. A few
   places read `process.env` directly: `proxy.ts` and
   `app/api/unlock/route.ts` (`SITE_PASSWORD*`), `lib/auth/csrf.ts`
   (`NEXT_PUBLIC_APP_URL`), `lib/rate-limit.ts` (KV credentials under both
   names), cookie `secure` flags (`NODE_ENV`) and
   `scripts/run-migrations.mjs`.
3. **`lib/chain/chains.ts` defines the chains.** RPC defaults, archive URLs,
   SS58 prefixes, CAIP-2 IDs, Subscan bases and treasury addresses live
   there and nowhere else.
4. **`lib/config.ts` holds app constants:** name, title and description.
5. **The R2 proposal JSON is the source of truth for a proposal's text.**
   The DB row is an index for list pages and points at the current version.
   The on-chain envelope (bound through `referenda.metadataOf`, or a legacy
   `system.remark`) pins one exact version by URL and hash.
6. **`lib/uploads/limits.ts` holds the upload limit** for the browser and
   the server.
7. **`lib/moderation/scan-settings.ts` lists the supported check models**
   and their prices in one table.

## When to add a new layer

Don't, unless you need it. The current layers are deliberately flat. If two
existing layers need shared logic, put it in the lower one (for example,
logic shared by `governance/` and `wallet/` goes in `chain/`).

## See also

- [`CHAIN_FLOW.md`](CHAIN_FLOW.md) - RPC connections, archive nodes, retries and fallbacks
- [`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md) - referenda lifecycle, votes and submissions
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - connectors and signing
- [`ENVIRONMENT.md`](ENVIRONMENT.md) - env vars
- [`DEPLOYMENT.md`](DEPLOYMENT.md) - Vercel, Neon and R2 setup
- [`HANDOVER.md`](HANDOVER.md) - operations and maintainer handover
- [`../SECURITY.md`](../SECURITY.md) - security model and reporting

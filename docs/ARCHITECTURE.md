# Architecture

> Read this first. It explains where code runs, how `lib/` is layered, what
> each module owns, and how data moves between the browser, the API routes,
> the chain and storage.

## Where code runs

| Place | What runs there | Talks to |
|---|---|---|
| Browser | Interactive pages (`"use client"`), `components/`, `lib/query` hooks, wallet connectors | Chain RPC over WebSocket, the app's API routes, wallets, CoinGecko, NFT metadata hosts |
| `proxy.ts` | CSRF check, `400` for malformed paths, site password gate, `noindex` headers and the `?network=` hint, before every request except static files, `robots.txt`, the sitemap and the manifest | Nothing outside the app |
| Route handlers | `app/api/**/route.ts`, `app/r/[...key]/route.ts` | Neon Postgres, Cloudflare R2, chain RPC, Subscan, Telegram, Anthropic API |
| Server components | Root layout, `/docs`, `/imprint`, `/privacy`, `/terms`, page metadata in the route layouts, OpenGraph images (edge) | Env vars only |
| Proposal layout | `app/proposals/[index]/layout.tsx`: metadata, structured data and a no-JavaScript summary | Neon Postgres (title and summary, 1.5 s budget) |
| Metadata routes | `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts` | The sitemap reads chain RPC and Neon |

Chain data is read in the browser. The server reads the chain only before
it acts on a proposal (to check whether a draft's envelope is on chain,
whether a referendum belongs to a draft, and whether it is still open for
edits) and for the sitemap's referendum count.

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
    │                        400 on a malformed path, site password
    │                        gate when enabled, noindex on private paths
    ▼
  app/api/**/route.ts        checks input, session, ownership, posting
  app/r/[...key]/route.ts    pause and rate limit, then does its work
    │
    ├── lib/auth/            sessions, SIWE, sign-in formats, roles, CSRF,
    │                        password gate
    ├── lib/db/              Neon SQL, one module per table group
    ├── lib/r2/              bucket client, uploads, key layout, images,
    │                        public-URL guard
    ├── lib/governance/      server-only: draft-versions, envelope-status,
    │                        attachment-check
    ├── lib/moderation/      policy, automatic checks, settings, check
    │                        health, notices, admin status
    ├── lib/subscan/         Subscan API wrapper
    ├── lib/telegram/        best-effort chat notices
    ├── lib/rate-limit.ts    fixed-window limits (shared KV or in-process)
    └── lib/chain/           getApi, for on-chain checks only

  app/robots.ts, app/sitemap.ts, app/manifest.ts, route layouts
    │
    └── lib/seo/             page metadata, structured data, sitemap
                             entries, the proposal layout's database read
```

## Module map

| Module | Runs on | Owns |
|---|---|---|
| `lib/chain/` | Both | Chain registry (`chains.ts`), connection pool (`api.ts`), primary→fallback helper (`connect.ts`), SS58 (`ss58.ts`), amounts and block times (`format.ts`), event and dispatch-error helpers (`events.ts`), active-chain store (`use-chain.ts`, browser) |
| `lib/governance/` | Both | Pallet readers and builders over an `ApiPromise` (referenda, preimage, conviction voting, tracks, treasury, deposits, staking pools, multi-tokens), batch builders (`submit-treasury-proposal.ts`, `proposal-batch.ts`, `proposal-calls.ts`, `enactment.ts`), the EGOV1 schema (`proposal-metadata.ts`), display, Markdown, media and lifecycle helpers (with the scheduler's enactment task in `scheduler.ts`, treasury payouts in `payout.ts` and the support denominator in `support.ts`). Server only: `draft-versions.ts`, `envelope-status.ts`, `attachment-check.ts`. Browser only: `confirm-client.ts` |
| `lib/query/` | Browser | React Query client (`client.ts`), provider, key factory (`keys.ts`), hooks in `hooks/` |
| `lib/wallet/` | Browser | Connectors (WalletConnect, browser extensions), registry, zustand store, `useWallet`, sign-request modal state, `useEnsureSignedIn`, session restore |
| `lib/auth/` | Server | SIWE message and signature check (`siwe.ts`), session cookie reader (`current-user.ts`), moderation roles (`roles.ts`), CSRF check (`csrf.ts`), handle and display-name rules (`handle-blocklist.ts`), the network of an address and which formats may sign in (`sign-in-network.ts`). `site-password.ts` is pure and shared with `proxy.ts` and `/unlock` |
| `lib/db/` | Server | Neon SQL: users, sessions, nonces, proposals and attachments, comments, moderation (including once-per-window slots and the schema checks for the Status tab), security disclosures |
| `lib/r2/` | Server | S3 client for R2 and the public-URL guard (`client.ts`), uploads and reads (`upload.ts`), image cleanup (`media-processing.ts`, `avatar.ts`). Pure and shared: key layout (`paths.ts`), stable JSON (`json.ts`), magic-byte sniffing (`sniff.ts`) |
| `lib/moderation/` | Server | Automatic checks (`scan.ts`, `auto-flag.ts`), check settings (`settings-store.ts`), check health (`scan-health.ts`), once-per-window gates (`slots.ts`), posting pauses, target lookup, report notices and content-check alerts (`notify.ts`), the Status tab's inputs (`status-probe.ts`). Pure and shared: `policy.ts`, `scan-settings.ts`, and the Status report (`status.ts`) |
| `lib/seo/` | Server | Page metadata (`metadata.ts`), structured data (`json-ld.tsx`), origin, gate and canonical-path helpers (`site.ts`), the `?network=` hint (`network-hint.ts`), the proposal layout's database read and no-JavaScript summary (`proposal.ts`, `proposal-fallback.tsx`), sitemap entries (`referenda.ts`) and a time budget for best-effort reads (`deadline.ts`) |
| `lib/uploads/` | Both | The 4 MB upload limit (`limits.ts`) and in-browser shrinking of large photos (`fit-for-upload.ts`) |
| `lib/rate-limit.ts` | Server | Fixed-window limiter and the `RATE_LIMITS` table |
| `lib/subscan/` | Server | Subscan API wrapper for the `app/api/subscan/*` routes |
| `lib/telegram/` | Server | `sendTelegramMessage`, and `postTelegramMessage`, which also says why a message wasn't delivered |
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
   `policy.ts`, `scan-settings.ts` and `status.ts`, `lib/telegram/**`,
   `lib/security/notify.ts`, `lib/legal/**`,
   `lib/seo/{proposal,referenda}.ts`, and
   `lib/governance/{draft-versions,envelope-status,attachment-check}.ts`.
   Two server modules don't carry the marker: `lib/rate-limit.ts` (kept
   importable from tests) and `lib/subscan/client.ts` (the proposal page
   imports its pure `normaliseSubscanCall`).
2. **Pure modules are shared.** Modules without I/O are imported from both
   sides, for example `lib/r2/paths.ts`, `lib/r2/json.ts`,
   `lib/moderation/policy.ts`, `lib/moderation/status.ts` (the Status
   panel formats its dates with it), `lib/uploads/**`, and most of
   `lib/governance/**` and `lib/chain/**`.
3. **The UI reads through hooks.** Pages and components get chain and API
   data from `lib/query` hooks. Direct `fetch` calls in the UI are kept to
   one-off requests (staging a draft, uploading media, the security and
   unlock forms) and to loading a proposal's JSON (resuming a draft, the
   edit page, and `proposal-metadata-header.tsx`, which also hashes it).
   The admin Status panel keeps its two React Query hooks in its own file
   (`components/moderation/status-panel.tsx`).
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
    │     ├── isPublicUrlMisconfigured → 503            [lib/r2/client.ts]
    │     ├── 4 MB cap, sniffMediaMime                  [lib/uploads/limits.ts, lib/r2/sniff.ts]
    │     ├── processProposalImage                      [lib/r2/media-processing.ts]
    │     ├── checkUpload                               [lib/moderation/auto-flag.ts]
    │     └── putObject(proposals/{net}/{uuid}/media/…) [lib/r2/upload.ts]
    ├── POST /api/proposals/draft                      "Stage"
    │     ├── isPublicUrlMisconfigured → 503            [lib/r2/client.ts]
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
  magic bytes, removes image metadata, scales still images to fit 2560 px
  and writes a WebP thumbnail. At staging, `checkAttachments` compares each
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
    └── POST /api/auth/nonce     [per-IP limit, signInNetworkOf,
                                  freshNonce + insertNonce → auth_nonces]
    └── signer.signRaw(message)  [the active connector's Signer]
    └── POST /api/auth/verify    [per-IP limit, signInNetworkOf,
                                  consumeNonceRow (atomic DELETE … RETURNING),
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
scoped by `network`, which `networkOfAddress` reads from the address's
exact SS58 prefix (`lib/auth/sign-in-network.ts`). Sign-in accepts only
the formats of the enabled networks, today `en…` and `cn…`, and answers
`400` for any other; the browser re-encodes the wallet's address to the
active chain's format first. The same key on Enjin Relay (`en…`) and
Canary (`cn…`) is two separate users, so handles live in per-network
namespaces: `@chris` on Canary doesn't block `@chris` on Relay.
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
  instance; after a failed read an instance keeps the settings it last
  read. An API outage never blocks posting.
- **Check health.** `classifyApiError` (`lib/moderation/scan.ts`) sorts a
  failed check into an outage, a problem with the item, or a setup problem
  (key, permission, model, credit, request format). `noteScanHealth`
  (`lib/moderation/scan-health.ts`) records a setup problem in
  `moderation_settings` (`content_scan_health`), and the next answered
  check clears it. Each instance keeps the record in memory and writes only
  when it changes, plus a "last seen" refresh at most every 15 minutes.
- **Once-per-window gates.** `claimSlot` (`lib/moderation/slots.ts`)
  claims a `slot:<name>` row in `moderation_settings` in one statement, so
  only one server wins per window. It limits the Telegram test message to
  one a minute and the content-check alert to one a day. Without the
  database, each server gates in memory.
- **Status tab.** `GET /api/moderation/status` (admins) gathers presence
  flags and database facts (`status-probe.ts`) and turns them into the
  checklist (`buildStatus` in `status.ts`, pure). No secret leaves the
  server. `POST /api/moderation/status/test-message` sends the Telegram
  test message.
- **Telegram notices.** `lib/telegram/send.ts` posts best-effort messages
  with a 5-second timeout: new reports and content-check alerts
  (`lib/moderation/notify.ts`), and new security disclosures
  (`lib/security/notify.ts`). `postTelegramMessage` reports a failure as a
  fixed reason, never the error text, because the request URL carries the
  bot token.

## Search metadata

Pages render in the browser from chain data, so what search engines and
link previews see comes from the server side of `app/` and `lib/seo/`:

- **Page metadata.** Public pages set a title, a description and a
  canonical path: in a `layout.tsx` when the page is a client component
  (`pageMetadata` in `lib/seo/metadata.ts`), otherwise in the page. Open
  Graph and Twitter fields follow from those and the route's
  `opengraph-image`. The root layout adds `metadataBase` from
  `NEXT_PUBLIC_APP_URL` and the site's JSON-LD.
- **Referendum pages.** `app/proposals/[index]/layout.tsx` loads what the
  database knows (`loadProposalSeo` in `lib/seo/proposal.ts`): the title,
  summary, proposer and withdrawal of a proposal that reached the chain,
  within 1.5 s, and nothing for one moderators hid or removed. It sets the
  metadata, Article and breadcrumb JSON-LD, a `<noscript>` note with the
  title and summary (`lib/seo/proposal-fallback.tsx`), and the header
  preview (`lib/seo/proposal-preview.ts`), so the title shows before the
  chain connection. Crawlers wait for all of it; browsers wait at most
  300 ms and get the rest streamed. Without a database, or past the
  budget, the page falls back to "Referendum #n". Another network's pages
  (`?network=`, read through the proxy's header) and user profiles are
  `noindex, follow`.
- **`/robots.txt`** (`app/robots.ts`) is built per request, so it follows
  the password gate: while the gate is on it disallows everything.
  Otherwise it disallows the private areas, allows the public API reads the
  pages make, and names the sitemap.
- **`/sitemap.xml`** (`app/sitemap.ts`, revalidated hourly) lists the public
  pages and, through `listPublicReferenda` (`lib/seo/referenda.ts`), every
  referendum of the default network: all indexes below
  `referenda.referendumCount` (5 s budget) plus database rows with their
  change dates (3 s budget). A source that fails or is too slow is left
  out; the response never fails. It is empty while the gate is on.
- **`/manifest.webmanifest`** (`app/manifest.ts`) makes the site
  installable.

## Request pipeline on the server

`proxy.ts` (Next.js 16's replacement for `middleware.ts`) runs first:

1. `enforceSameOrigin` (`lib/auth/csrf.ts`) refuses a POST, PATCH, PUT or
   DELETE to `/api/*` whose `Origin` (or `Referer`) host isn't this site.
2. A path with a broken `%`-escape gets `400 Bad Request`, instead of a
   `500` from the router later.
3. When `SITE_PASSWORD_STATUS=ON`, a request without a valid access cookie
   is redirected to `/unlock`. The gate lets through `/unlock`,
   `/api/unlock`, `/brand/*`, the legal pages, OpenGraph images, and social
   link previewers on non-API paths. The proxy's matcher skips
   `/robots.txt`, `/sitemap.xml` and `/manifest.webmanifest`, so those stay
   open too.
4. A request that passes gets `X-Robots-Tag: noindex` on private paths
   (`/api`, `/account`, `/create`, `/moderation`, `/unlock`,
   `/proposals/*/edit`, `/r/`), and on every path while the gate is on. On
   `/proposals/*`, the `?network=` value is copied into the
   `x-proposal-network` request header for the proposal layout, which
   can't read the query string; a client-sent value is always replaced.

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
  configured (`isDbConfigured`, `isR2Configured`). Routes that build file
  URLs (staging a draft, editing a proposal, media and avatar uploads) also
  answer 503 on Vercel's production deployment while `NEXT_PUBLIC_APP_URL`
  points at localhost (`isPublicUrlMisconfigured` in `lib/r2/client.ts`),
  and `publicAssetBase()` throws in that state, so no such URL is stored
  or pinned on chain.

## Tests

There are three layers. `pnpm test` (Vitest) runs the first two;
`pnpm test:e2e` (Playwright) runs the third.

**Unit and route tests** (`lib/**`):

- Unit tests sit in `__tests__/` folders next to the modules they cover.
- `lib/__sec__/` holds route-level security tests. They import the real
  route handlers and `proxy.ts`, and replace only I/O: in-memory proposal
  tables (`fake-db.ts`), bucket (`fake-bucket.ts`) and moderation tables
  (`fake-moderation.ts`), plus mocks for auth, rate limits and the chain.
- `vitest.config.ts` runs `lib/**` tests in Node and stubs `server-only`
  with `test/server-only-stub.ts`.

**Database tests** (`*.pg.test.ts`, mostly in `lib/db/__tests__/`):

- They run the real SQL in `lib/db` against PGlite, Postgres compiled to
  WebAssembly, in process. `test/pglite.ts` applies every migration in
  `scripts/` the way `pnpm db:migrate` does, and returns a client that
  behaves like Neon's: parameters, result types and errors match.
- A test file mocks `@/lib/db/client` with `dbClientMock` and calls
  `setupTestDb()`. Each file gets its own database, emptied before every
  test. The migrated database is cached in the OS temp directory, keyed by
  the migration files and the PGlite version.
- No Postgres server or `DATABASE_URL` is needed, so they run in the same
  `pnpm test` locally and in CI.

**Browser tests** (`e2e/`, config in `playwright.config.ts`):

- Playwright drives Chromium against the production build on
  `http://localhost:3100`. `e2e/support/test.ts` gives each test a fake
  extension wallet whose signer refuses everything, answers every `/api/*`
  and `/r/*` request with test data (`mock-api.ts`, `data.ts`), and blocks
  requests to outside hosts. Chain data is real: it comes from the Canary
  Relay RPC and archive node, and the tests read a concluded referendum
  there.
- They cover the proposal page with its verified EGOV1 text, the report
  dialog on phone widths, the wrong-network address dialog, uploads (a PDF
  over 4 MB is refused in the browser, a large photo is shrunk before
  sending), a moderation action that needs a reason, and the legal pages
  and footer.
- Locally, `pnpm test:e2e` builds with the right `NEXT_PUBLIC_APP_URL`,
  starts the server and runs the tests; it reuses a server already running
  on port 3100. It needs Playwright's Chromium
  (`pnpm exec playwright install chromium`) or `PW_CHROMIUM_PATH`. By
  default the browser's chain sockets are relayed through Node
  (`e2e/support/chain-relay.ts`), for sandboxes whose browser proxy
  refuses WebSockets; `E2E_WS_RELAY=0` connects directly.
- In CI, the **Browser tests** job builds once and runs them with
  `E2E_SKIP_BUILD=1`, with two retries per test. The Playwright report is
  uploaded when a test fails.

## Source-of-truth rules

1. **The chain RPC is canonical.** Subscan, Neon, R2 and any future indexer
   are caches or enrichment, never sources of truth for on-chain state.
2. **`lib/env.ts` defines the env vars.** New variables go there. A few
   places read `process.env` directly: `proxy.ts`,
   `app/api/unlock/route.ts` and `lib/seo/site.ts` (`SITE_PASSWORD*`),
   `lib/auth/csrf.ts` (`NEXT_PUBLIC_APP_URL`), `lib/rate-limit.ts` (KV
   credentials under both names), `lib/r2/client.ts` (`VERCEL_ENV`),
   `lib/moderation/status-probe.ts` (`VERCEL_ENV`, `NODE_ENV`, and whether
   a variable was set at all), cookie `secure` flags (`NODE_ENV`) and
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

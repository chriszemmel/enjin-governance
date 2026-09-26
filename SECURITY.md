# Security Policy

This document explains how to report a vulnerability, what is in scope, the
protections the client ships with, and the steps an operator should take
before running it in production.

## Reporting a vulnerability

Please report privately, and give us time to fix the issue before it is
made public.

- **Preferred:** the form at **`/security`** on the running site. It needs no
  account or wallet. Reports are stored in the database
  (`app/api/security-disclosures/route.ts`) and, when Telegram is configured,
  also sent to the maintainers' private chat. Include the impact, the steps
  to reproduce and the affected component.
- **If the form is unavailable** (it needs the database), write to the
  contact address on the site's `/imprint` page.
- Do **not** open a public GitHub issue, pull request or social post for a
  security bug, and do not share exploit details until a fix has shipped.

The form is rate-limited per IP address and drops bots with a hidden
honeypot field. The IP address is stored only as a SHA-256 hash, never in
plain form. If you leave a contact, we will keep you updated and, with your
consent, credit you once the issue is fixed.

## Scope

**In scope** (this client and its API):

- Sign-in and sessions: signed messages, nonces, session cookies.
- Authorization on the API routes: proposal drafts, edits, withdrawal,
  cancellation and linking to a referendum; comments and comment edits;
  profiles; uploads; moderation actions, roles and settings; the admin
  Status page.
- The off-chain metadata pipeline: EGOV1 JSON, R2 storage, the `/r` file
  route and the Neon mirror.
- Moderation: hidden or held files being served, bypassing a role check,
  forcing an upload past the automatic check, or leaking reporters.
- The site password gate (`proxy.ts`, `/api/unlock`).
- Cross-site request forgery, injection, XSS, SSRF, open redirects, secret
  exposure and access-control flaws in the web app and its API.

**Out of scope:**

- The Enjin Relay and Canary runtimes and their pallets (`referenda`,
  `convictionVoting`, `treasury`, `preimage` and others). Report chain-level
  issues to Enjin directly.
- Third-party wallets, browser extensions and the WalletConnect protocol.
- Third-party services: Cloudflare R2, Neon, Vercel, Upstash, Anthropic,
  Telegram, Subscan, CoinGecko and RPC providers.
- A single piece of content that the automatic check fails to flag. The
  check is an aid for moderators, not a guarantee.
- Volumetric denial of service, and findings that need a compromised
  device, a malicious browser extension or social engineering of a user.

## Security model

### Sign-in and sessions

- **Sign-in by signature.** `POST /api/auth/nonce` issues a random
  single-use nonce, bound to the address, valid for 30 minutes and stored
  in `auth_nonces` together with the exact message to sign. The wallet signs
  that message. `POST /api/auth/verify` deletes the nonce and checks the
  signature against the stored message in one step, so a nonce works once
  and the client never supplies the message (`lib/auth/siwe.ts`).
- **Sessions.** A successful sign-in sets an `httpOnly`, `SameSite=Lax`
  cookie (`Secure` in production) valid for 30 days. The database stores
  only the SHA-256 of the session token, never the token. Signing out
  deletes the session row.
- **Sign-in address formats.** Both sign-in routes accept only an address
  in the format of a network the site runs on: today the Enjin Relaychain
  (`en…`) and Canary Relaychain (`cn…`). The network is read from the
  address's exact SS58 prefix (`lib/auth/sign-in-network.ts`); any other
  format, or a raw public key, gets `400`. The browser re-encodes the
  wallet's address to the active network's format first, so every wallet
  still works. Each new user row therefore has a network, and handles are
  unique per network. An older row without a network (from a sign-in in
  another format) cannot claim a handle; its owner is asked to sign in
  again, which uses the network's format and that address's own row.
- **Ownership by public key.** Routes compare the caller's **public key**
  with the owner's, so the `en…` and `cn…` forms of the same key match and
  nothing else does.
- **Session details.** The session row stores the caller's IP address only
  when the first `X-Forwarded-For` entry is a valid IP, so a malformed
  proxy header cannot break sign-in after the nonce was used.
- **Display names.** Names are stored without invisible and
  direction-control characters, and checked against reserved phrases in a
  folded form (look-alike spaces, full-width or styled letters, accents),
  so spacing or look-alike tricks cannot pass as "Enjin Support"
  (`lib/auth/handle-blocklist.ts`).
- **Profiles.** A profile field sent as `null` is cleared (the account page
  sends an emptied field that way); a field left out keeps its value.
  Profile saves are rate-limited, which also slows probing which handles
  are taken.

### Cross-site requests and the password gate

- **Cross-site write blocking.** `proxy.ts` runs `lib/auth/csrf.ts` on every
  `POST`, `PUT`, `PATCH` and `DELETE` to `/api/*`. A request whose `Origin`
  (or `Referer`) names another host gets `403`. Requests with neither header
  are allowed: they cannot come from a browser page carrying a victim's
  cookie.
- **Site password gate.** With `SITE_PASSWORD_STATUS=ON`, `proxy.ts` sends
  every request without the access cookie to `/unlock`, including the API
  and the `/r` file route. The legal pages, the brand assets, OpenGraph
  images, `robots.txt`, the sitemap and the manifest stay open.
  Link-preview crawlers may read everything outside `/api/` so that shared
  links show a preview; they are recognised by user
  agent, which can be faked. The gate is meant to keep a staging site
  private, not to protect secrets. Password attempts are rate-limited per
  IP, the redirect after unlocking only goes to a path on the same site,
  and changing `SITE_PASSWORD` invalidates every access cookie.
- **Password comparison.** `/api/unlock` hashes the typed and the
  configured password with SHA-256 and compares the two digests in
  constant time (`passwordMatches` in `lib/auth/site-password.ts`), so the
  time taken reveals nothing about the password or its length. The access
  cookie, itself such a digest, is compared in constant time too.
- **Malformed paths.** A path with a broken `%`-escape gets `400 Bad
  Request` from `proxy.ts` instead of a server error.

### Private areas and search engines

- `robots.txt` keeps crawlers out of `/api/`, `/account`, `/create`,
  `/moderation` (not `/moderation-log`), `/unlock`, `/proposals/*/edit`
  and `/r/`. `proxy.ts` also sends `X-Robots-Tag: noindex` on these paths,
  for crawlers that arrive by a link anyway.
- While the password gate is on, `robots.txt` disallows everything, the
  sitemap is empty and every response the gate lets through carries
  `noindex`.
- User profiles and other networks' referendum pages are marked `noindex`.
- Search metadata and the no-JavaScript summary of a referendum page use
  only proposal text that reached the chain, and leave out the title and
  summary of a proposal moderators hid or removed.
- Structured data (JSON-LD) escapes `<`, `>` and `&`, so a proposal title
  cannot end its `<script>` element (`lib/seo/json-ld.tsx`).
- On `/proposals/*`, the proxy replaces any client-sent
  `x-proposal-network` header with the checked `?network=` value, and the
  proposal layout accepts only an enabled chain.

### Rate limits

`lib/rate-limit.ts` holds all limits in one table, `RATE_LIMITS`. They are
fixed-window limits that answer `429` with a `Retry-After` header:

| Limit | Key | Requests | Window |
|---|---|---|---|
| Sign-in nonce | IP | 10 | 1 minute |
| Sign-in verify | IP | 20 | 5 minutes |
| Security reports | IP | 5 | 10 minutes |
| Password-gate attempts | IP | 10 | 5 minutes |
| Profile saves | User | 20 | 10 minutes |
| New comments | User | 20 | 1 minute |
| Comment edits | User | 10 | 5 minutes |
| Comment deletes | User | 20 | 1 minute |
| Staging drafts and editing proposals (shared) | User | 10 | 1 minute |
| Linking a proposal to its referendum (confirm) | User | 30 | 5 minutes |
| Cancelling a draft | User | 20 | 5 minutes |
| Withdrawing a proposal, or undoing it | User | 10 | 5 minutes |
| Media uploads and removals (shared) | User | 30 | 5 minutes |
| Avatar uploads | User | 10 | 5 minutes |
| Content reports | User | 10 | 10 minutes |
| Moderation actions | User | 60 | 1 minute |
| Telegram notices about new reports | Global | 20 | 1 hour |

The global notice limit keeps a flood of reports from flooding the
moderators' chat. Two admin-side notices are limited separately, through
a gate shared by all servers (`lib/moderation/slots.ts`): the Telegram test
message to once a minute, and the content-check alert to once a day.

With `KV_REST_API_URL` and `KV_REST_API_TOKEN` set, the counts live in
Upstash Redis and hold across serverless instances. Without them, or if the
store fails, each instance counts on its own. Limiting is never switched off.

### Input and rendering

- JSON request bodies are validated with Zod schemas. Batch endpoints cap
  the size of their input arrays.
- Proposal Markdown is rendered to React elements, never through
  `dangerouslySetInnerHTML`. Links must be `http(s)` URLs or paths on the
  same site. Comments are plain text.
- Database access is parameterized throughout.
- `next.config.mjs` sets a Content Security Policy, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff` and a strict referrer policy.

### Comment edits

- Only the author can edit a comment (`PATCH /api/comments/[id]`), for 15
  minutes after posting. A comment that was deleted, or that moderators
  hid or removed, can't be edited. While the author's posting is paused,
  none of their comments can. If the moderation state cannot be read, the
  edit is refused.
- The database update repeats the author, deleted and time checks, so a
  delete or the end of the window in between cannot be raced.
- The new text replaces the old one; no history is kept. The thread shows
  "edited", and the automatic text check runs again on the new text.

### Uploads and stored files

- **Size.** One file may be at most 4 MB (`lib/uploads/limits.ts`), because
  the host refuses larger request bodies. Large photos are shrunk in the
  browser before upload.
- **Type by content.** Proposal media must be PNG, JPEG, WebP, GIF or PDF.
  The type is read from the file's bytes (`lib/r2/sniff.ts`), not from the
  browser's claim, and the file is stored under the type it really has.
  SVG and HTML are never accepted.
- **Images are re-encoded.** Proposal images are decoded and written again
  with metadata removed (EXIF, GPS, comments), with a limit against
  decompression bombs (`lib/r2/media-processing.ts`). Still images are
  scaled to at most 2560 px; GIFs and animated WebPs keep their size and
  animation. Avatars are re-encoded to a 150 px PNG.
- **No localhost links on chain.** On Vercel's production deployment,
  staging a draft, editing a proposal and uploading files or avatars
  answer `503` while `NEXT_PUBLIC_APP_URL` points at localhost, and the
  storage code refuses to build such a URL before anything is written
  (`isPublicUrlMisconfigured` in `lib/r2/client.ts`).
- **Attachment details are checked.** The name, size, type and hash that a
  proposal lists for each attachment go into its JSON, whose hash is pinned
  on chain. The server compares each one with the stored file and refuses
  anything that does not match; names are cleaned of characters that can
  disguise them (`lib/governance/attachment-check.ts`).
- **One way out.** Files are served through the app's `/r` route, which
  only serves known public prefixes, applies moderation and sends
  `nosniff`. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#hidden-files-and-the-buckets-own-url)
  for the bucket's own public URL.
- Unsigned drafts are visible only to their proposer. A draft is linked to
  a referendum only if the referendum was filed by the draft's proposer and
  enacts the draft's call, so a copied EGOV1 envelope cannot claim it.

### Reclaiming deposits

The runtime lets depositors unnote their preimages while they are
`Unrequested`, including some that are still in use. The Reserved
deposits panel on `/account` guards against that
(`lib/governance/deposits.ts`):

- The call of an ongoing referendum is not offered for reclaim. Unnoting it
  would leave the referendum nothing to enact.
- A preimage that holds a proposal's on-chain record (its hash is a
  referendum's `metadataOf`, or its bytes start with `EGOV1:`) is marked as
  such, and the panel asks for confirmation before unnoting it. Unnoting it
  leaves the referendum's EGOV1 record unresolvable from chain.
- If the chain reads behind these checks fail, the whole list fails to
  load, so no unchecked preimage is ever offered for reclaim.

### Moderation

- **Roles by wallet.** Admins are listed in `GOVERNANCE_ADMIN_PUBLIC_KEYS`
  and cannot be removed in the app. Admins grant moderator and admin roles
  in **Moderation → Roles**; these are stored by public key. Every
  moderator and admin route checks the role on the server
  (`lib/auth/roles.ts`).
- **What each role can do.** Moderators keep, blur, hide or restore
  proposals, attachments and comments. Admins can also delete files (for
  legal takedowns), pause a wallet's posting, manage roles and change the
  content-check settings. Nobody can edit someone else's text, and nothing
  touches on-chain data or the stored proposal JSON.
- **Public log.** Every action needs a reason and appears at
  `/moderation-log` with the moderator's handle or short address. Reporters
  are never shown.
- **Status tab.** `GET /api/moderation/status` (admins only) reports
  whether each setting is present, with short fixed hints. It never
  returns a secret, key, token or connection string, nor an error message,
  since a database error can name the host. Telegram failures are reported
  as fixed reasons, never as the error itself, because the request URL
  carries the bot token.
- **Backups.** Only admins can create, list, download or delete a backup.
  It contains profiles, comments, reports and the contacts left in
  security reports, but never sign-in sessions or nonces. Backups are kept
  under `backups/` in R2, which `/r` never serves; the routes accept only
  keys of the exact shape they create, and a download is a signed link
  valid for five minutes. Treat a downloaded backup like the production
  database.

### Automatic content checks

- Off until an admin switches them on in **Moderation → Settings**, and
  only when `ANTHROPIC_API_KEY` is set. The key stays on the server.
- Images and PDFs are checked before they are stored. A clear violation,
  such as a readable recovery phrase, is rejected (or held, if admins chose
  that). Borderline files are stored blurred, are not served, and wait for
  a moderator.
- Proposal text and comments are checked after posting. The check can only
  add an entry to the review queue; it never hides text.
- **Hard daily limit.** Every check is counted before it is sent, and text
  may use at most half of the limit. Past the limit, uploads wait for a
  moderator and text is not checked until the next day (UTC). A check that
  cannot be counted because the database is failing is not sent: the
  upload waits for a moderator, or is refused with a "try again" when the
  hold cannot be saved either.
- An outage of the checking service never blocks posting. An upload that
  cannot be checked for a reason the uploader controls (an animation, a
  long PDF, input the model rejects) waits for a moderator instead.
- A setup problem (the key refused, the model gone, no credit left) is
  treated like an outage, so uploads are posted unchecked. It is recorded,
  shown to admins in **Moderation → Status** and **Settings**, and
  reported to the moderators' Telegram chat at most once a day.
- If the settings cannot be read, each server keeps the ones it last read,
  so a database outage cannot switch the checks off.

### Secrets and configuration

- Server variables and browser variables are separated in `lib/env.ts`. No
  secret uses the `NEXT_PUBLIC_` prefix, so none reaches the browser bundle.
- No secret values are stored in the repository.

### Tests

Route-level security tests live in `lib/__sec__`. They run the real route
handlers, `proxy.ts`, role and ownership checks, rate limiter and image
processing, and replace only I/O (database, bucket, Anthropic, Telegram)
with in-memory fakes. They cover sign-in and its address formats,
profiles, the password gate, `noindex` headers and malformed paths,
security reports, drafts and edits, withdrawal and cancellation, linking
to a referendum, comments and comment edits, uploads and failed content
checks, moderation, roles and the admin Status routes.

The SQL in `lib/db` is tested against PGlite, a real Postgres, with every
migration applied (`*.pg.test.ts`, helper in `test/pglite.ts`). Those tests
cover, among others, the daily check limit under concurrent requests, the
draft guards, comment edits and the per-network handles. `pnpm test` runs
both with the rest of the suite. Browser tests in `e2e/` (`pnpm test:e2e`)
check, among others, that a moderation action needs a reason.

## Operator hardening

Before running your own instance in production:

1. Set `NEXT_PUBLIC_APP_URL` to the final `https://` domain before any real
   proposal is filed. File URLs built from it are pinned on chain. Vercel's
   production deployment refuses drafts and uploads while it points at
   localhost; other hosts don't check.
2. Configure the shared rate-limit store (`KV_REST_API_URL`,
   `KV_REST_API_TOKEN`) so limits hold across instances.
3. Give the R2 API token object read and write access to this one bucket
   only. Keep the bucket's public access off, or block media on its custom
   domain as described in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
4. Keep every secret in the host's environment settings, never in a
   `NEXT_PUBLIC_` variable or in the repository.
5. List only wallets you control in `GOVERNANCE_ADMIN_PUBLIC_KEYS`, and
   grant other roles in the app.
6. If you use the automatic checks, set a spending limit on the Anthropic
   account and a daily check limit in **Moderation → Settings**.
7. Send Telegram notices to a private chat. Security reports are posted
   with their text and the reporter's contact.
8. Per-IP limits use the first `X-Forwarded-For` entry. Vercel sets this
   header itself. Behind another proxy, make sure it replaces the header
   rather than passing on the client's value.
9. Turn the password gate off (`SITE_PASSWORD_STATUS=OFF`) once the site is
   public, and do not rely on it to protect anything sensitive.
10. After every deploy, open **Moderation → Status** as an admin and fix
    every item marked Problem.

## Supported versions

Security fixes go into the latest version on `main`. Older versions are not
patched; update to the latest release.

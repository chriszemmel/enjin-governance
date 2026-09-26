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
  cancellation and linking to a referendum; comments; profiles; uploads;
  moderation actions, roles and settings.
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
- **Ownership by public key.** Routes compare the caller's **public key**
  with the owner's, so the `en…` and `cn…` forms of the same key match and
  nothing else does. Addresses must be valid SS58 before a user row is
  created.

### Cross-site requests and the password gate

- **Cross-site write blocking.** `proxy.ts` runs `lib/auth/csrf.ts` on every
  `POST`, `PUT`, `PATCH` and `DELETE` to `/api/*`. A request whose `Origin`
  (or `Referer`) names another host gets `403`. Requests with neither header
  are allowed: they cannot come from a browser page carrying a victim's
  cookie.
- **Site password gate.** With `SITE_PASSWORD_STATUS=ON`, `proxy.ts` sends
  every request without the access cookie to `/unlock`, including the API
  and the `/r` file route. The legal pages, the brand assets and OpenGraph
  images stay open. Link-preview crawlers may read everything outside
  `/api/` so that shared links show a preview; they are recognised by user
  agent, which can be faked. The gate is meant to keep a staging site
  private, not to protect secrets. Password attempts are rate-limited per IP, the redirect
  after unlocking only goes to a path on the same site, and changing
  `SITE_PASSWORD` invalidates every access cookie.

### Rate limits

`lib/rate-limit.ts` holds all limits in one table, `RATE_LIMITS`. They are
fixed-window limits that answer `429` with a `Retry-After` header:

- Per IP address: sign-in (nonce and verify), security reports and
  password-gate attempts.
- Per user: comments, drafts and edits, media and avatar uploads, content
  reports and moderation actions.
- Globally: Telegram notices about new moderation reports, so a flood of
  reports cannot flood the moderators' chat.

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

### Uploads and stored files

- **Size.** One file may be at most 4 MB (`lib/uploads/limits.ts`), because
  the host refuses larger request bodies. Large photos are shrunk in the
  browser before upload.
- **Type by content.** Proposal media must be PNG, JPEG, WebP, GIF or PDF.
  The type is read from the file's bytes (`lib/r2/sniff.ts`), not from the
  browser's claim, and the file is stored under the type it really has.
  SVG and HTML are never accepted.
- **Images are re-encoded.** Proposal images are decoded and written again
  with metadata removed (EXIF, GPS, comments), scaled to at most 2560 px,
  with a limit against decompression bombs (`lib/r2/media-processing.ts`).
  Avatars are re-encoded to a 150 px PNG.
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
  moderator and text is not checked until the next day (UTC).
- An outage of the checking service never blocks posting. An upload that
  cannot be checked for a reason the uploader controls (an animation, a
  long PDF, input the model rejects) waits for a moderator instead.

### Secrets and configuration

- Server variables and browser variables are separated in `lib/env.ts`. No
  secret uses the `NEXT_PUBLIC_` prefix, so none reaches the browser bundle.
- No secret values are stored in the repository.

### Tests

Route-level security tests live in `lib/__sec__`. They run the real route
handlers, role and ownership checks, rate limiter and image processing,
and replace only I/O (database, bucket, Anthropic, Telegram) with
in-memory fakes. They cover sign-in, profiles, the password gate, security
reports, drafts and edits, withdrawal and cancellation, linking to a
referendum, comments, uploads, moderation and roles. `pnpm test` runs them
with the rest of the suite.

## Operator hardening

Before running your own instance in production:

1. Set `NEXT_PUBLIC_APP_URL` to the final `https://` domain before any real
   proposal is filed. File URLs built from it are pinned on chain.
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

## Supported versions

Security fixes go into the latest version on `main`. Older versions are not
patched; update to the latest release.

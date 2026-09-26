# Deployment

The app runs on **Vercel**, with **Neon** (Postgres), **Cloudflare R2**
(files) and **Reown** (WalletConnect Cloud). Optional services: **Upstash
Redis** for shared rate limits, **Anthropic** for automatic content checks,
**Telegram** for notices and **Subscan** for old call data.

Every variable is described in [`ENVIRONMENT.md`](ENVIRONMENT.md).

## Order of steps

1. [Neon](#neon): create the database and apply the migrations.
2. [Cloudflare R2](#cloudflare-r2): create the bucket and an API token.
3. [Reown](#reown-walletconnect-cloud): create a project.
4. [Vercel](#vercel): import the repository, set the variables, deploy.
5. Add the deployed domain to Reown's allowed domains.
6. [Moderation](#moderation): make the first admin; optionally set up
   content checks and Telegram.
7. [Legal pages](#legal-pages-and-footer): set your own details and
   redeploy.

## Vercel

1. Import the repository at <https://vercel.com/new>. The framework preset
   is **Next.js** (detected). Use Node 22 (see `.nvmrc`); pnpm is picked up
   from `packageManager` in `package.json`.
2. Set the variables under **Settings → Environment Variables**:

   | Name | Value | Environments |
   |---|---|---|
   | `NEXT_PUBLIC_APP_URL` | `https://your-domain` | Production |
   | `NEXT_PUBLIC_APP_URL` | your preview domain | Preview |
   | `NEXT_PUBLIC_DEFAULT_NETWORK` | `enjin-relay` for mainnet, `canary-relay` for testnet | All |
   | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | from Reown | All |
   | `DATABASE_URL` | Neon pooled connection string | Production, Preview |
   | `DATABASE_URL_UNPOOLED` | Neon unpooled connection string | Production, Preview |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from Cloudflare | Production, Preview |
   | `R2_BUCKET` | bucket name (default `enjin-governance`) | Production, Preview |
   | `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | Production, Preview |
   | `R2_PUBLIC_URL` | bucket's public URL, or an `https://` placeholder | Production, Preview |
   | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | from Upstash (recommended) | Production, Preview |
   | `GOVERNANCE_ADMIN_PUBLIC_KEYS` | your wallet address(es) | Production, Preview |
   | `ANTHROPIC_API_KEY` | optional, automatic content checks | Production |
   | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_MODERATION_CHAT_ID` | optional, notices | Production |
   | `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_ADDRESS`, `LEGAL_CONTACT_EMAIL` | your details | Production, Preview |
   | `LEGAL_CONTACT_PHONE`, `LEGAL_VAT_ID` | optional, imprint | Production, Preview |
   | `NEXT_PUBLIC_SITE_MAINTAINER`, `NEXT_PUBLIC_SOURCE_URL` | your name and source repository | All |
   | `SUBSCAN_API_KEY` | optional, from <https://pro.subscan.io> | Production |
   | `SITE_PASSWORD_STATUS`, `SITE_PASSWORD` | optional, password gate for staging | as needed |

3. Deploy.

Notes:

- File URLs are built from `NEXT_PUBLIC_APP_URL`, so a preview without it
  would hand out `http://localhost:3000` links. Do not file real proposals
  from a preview: the file URL in the EGOV1 record is pinned on chain.
- Changing any variable takes effect only on the next deployment.
- Vercel refuses request bodies over 4.5 MB. Uploads are therefore capped
  at 4 MB per file (`lib/uploads/limits.ts`), and large photos are shrunk
  in the browser first.

## Neon

1. Create a project at <https://neon.tech>.
2. Copy both connection strings: the **pooled** one (host contains
   `-pooler`) for `DATABASE_URL` and the **unpooled** one for
   `DATABASE_URL_UNPOOLED`.
3. Apply the migrations:

   ```bash
   DATABASE_URL_UNPOOLED="postgres://..." pnpm db:migrate
   ```

   `scripts/run-migrations.mjs` applies every `scripts/NNN_*.sql` (or
   `.mjs`) file in order, records each one in a `_migrations` table and
   skips files already recorded. Run it again after every update that adds
   a migration.

4. Set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel.

Without `DATABASE_URL`, sign-in answers `503`, profiles, comments, drafts,
moderation and security reports are unavailable, and the rest of the app
keeps working from the chain.

### Migrations

| File | Adds |
|---|---|
| `004_proposals_comments_profiles.sql` | Users, sessions, proposals, attachments, comments, reactions, `updated_at` triggers |
| `005_user_verification.sql` | `users.is_verified` (set by hand in the database only) |
| `006_proposal_edits.sql` | Edit timestamp and count on proposals |
| `007_proposal_withdrawal.sql` | Off-chain withdrawal note on proposals |
| `008_auth_nonces.sql` | Sign-in nonces |
| `009_users_per_network_handle.sql` | Handles unique per network instead of globally |
| `010_security_disclosures.sql` | Reports from the `/security` form |
| `011_moderation.sql` | Roles, item state, public action log, reports, posting pauses |
| `012_moderation_settings.sql` | Content-check settings and daily usage per model |
| `013_moderation_keep_state.sql` | Moderation state and reports outlive a deleted draft (foreign keys `ON DELETE SET NULL`) |

To apply them by hand instead, run each file in order with
`psql "$DATABASE_URL_UNPOOLED" -f scripts/<file>`. Choose one method:
`004`, `008` and `010` fail if run twice, and the runner only knows about
files it applied itself. If you switch to the runner later, first insert
the applied file names into `_migrations`.

Migrations are forward-only. Keep them backward-compatible (add columns,
don't drop them) for at least one deploy, so a rollback still works.

### Schema overview

| Table | Purpose |
|---|---|
| `users` | One row per SS58 address: handle (unique per network), display name, bio, avatar, `is_verified`. |
| `wallet_sessions` | One row per signed-in session: SHA-256 of the session token, expiry, user agent and IP address. |
| `auth_nonces` | Single-use sign-in nonces with the exact message to sign; deleted when used. |
| `proposals` | Index of every proposal filed through the app. `status` is one of `draft`, `submitted`, `on_chain`, `failed`, `cancelled`. The JSON in R2 is canonical. |
| `proposal_attachments` | Files listed by a proposal, by bucket key. |
| `comments` | Threaded comments per proposal. Deleting one only marks it deleted. |
| `comment_reactions` | Emoji reactions per comment. Not used by the current UI. |
| `security_disclosures` | Reports from `/security`. The IP address is stored only as a SHA-256 hash. |
| `moderation_roles` | Moderator and admin grants, by public key. |
| `moderation_state` | Current state of a proposal, attachment or comment: visible, blurred, hidden or removed. |
| `moderation_actions` | The public moderation log. |
| `moderation_reports` | User reports and automatic flags, open until a moderator decides. |
| `moderation_suspensions` | Posting pauses set by admins, by public key. |
| `moderation_settings` | Settings for the automatic content checks. |
| `moderation_scan_usage` | Checks and tokens per day, model and kind, for the daily limit and the cost shown to admins. |
| `_migrations` | Files applied by `pnpm db:migrate`. |

There is no migration framework by design: flat, forward-only SQL files
are easier to audit.

## Cloudflare R2

1. Create a bucket at <https://dash.cloudflare.com>. The default name in the
   configuration is `enjin-governance`.
2. Create an R2 API token with the **Object Read & Write** permission,
   applied to this bucket only.
3. Leave the bucket's public access off, unless older proposals depend on
   it (see [below](#hidden-files-and-the-buckets-own-url)).
4. Set the `R2_*` variables in Vercel. `R2_PUBLIC_URL` must be set for
   storage to count as configured: use the bucket's public URL if it has
   one, otherwise any `https://` placeholder.

CORS on the bucket is not needed: every write goes through the app's API,
and every read through its `/r` route.

### Files are served by the app, not the bucket

Public reads (proposal JSON, media, avatars) are served from the app's own
origin by the `/r/<key>` route (`app/r/[...key]/route.ts`). It streams the
object from R2 with its stored content type, applies moderation, and allows
cross-origin reads so anyone can fetch and verify proposal JSON. The URLs
the app hands out, including the EGOV1 pointer pinned on chain, are
`https://<app>/r/...`, built from `NEXT_PUBLIC_APP_URL`.

This keeps the on-chain pointer on the app's own domain, independent of
where the bucket lives, and away from the rate-limited `r2.dev` URL.
Because the pointer is fixed at submission, `NEXT_PUBLIC_APP_URL` must be
the final production domain before any mainnet proposal is filed.

### Hidden files and the bucket's own URL

Moderation (blurring, hiding, holds by the automatic check) is enforced by
`/r`. If the bucket's own public URL (`r2.dev` or a custom domain) is
enabled, Cloudflare serves files from it directly and moderation does not
apply there. So:

- If no proposal links to the bucket URL, turn public access off.
- Proposals filed before 28 June 2026 pinned the bucket URL in their EGOV1
  record, and turning it off breaks their verification. In that case, keep
  a custom domain (not `r2.dev`) and add a Cloudflare WAF rule on it that
  blocks `/proposals/*/media/*`, so only the JSON stays public there. `/r`
  keeps serving media with moderation applied.
- Legal takedowns use **Delete file**, which removes the object itself and
  works either way.

## Reown (WalletConnect Cloud)

1. Create a project at <https://cloud.reown.com>.
2. Set the app URL to your domain.
3. Copy the project ID into `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
4. Under **Allowed Domains**, add:
   - your production domain,
   - `*.vercel.app` for preview deployments,
   - `localhost:3000` for local development.

Without your domain in this list, the WalletConnect modal refuses to load
the app's metadata.

## Upstash Redis (rate limits)

Rate limits work without it, but each serverless instance then counts on
its own. For limits that hold across instances:

1. Add Upstash Redis through the Vercel Marketplace, or create a database
   in the Upstash console.
2. Make sure `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set. The
   marketplace integration sets them; the names `UPSTASH_REDIS_REST_URL`
   and `UPSTASH_REDIS_REST_TOKEN` also work.

Only the REST URL and token are used. If the store is unreachable, the app
falls back to per-instance counting.

## Moderation

### The first admin

1. Put your wallet address (SS58 on any Enjin network, or the `0x` public
   key) in `GOVERNANCE_ADMIN_PUBLIC_KEYS`. Separate several with commas.
2. Apply the migrations (`011` to `013` are needed).
3. Redeploy and sign in with that wallet. **Moderation** appears in the
   navigation.
4. Grant further moderators and admins under **Moderation → Roles**.
   Admins from the environment cannot be removed in the app.

### Telegram notices (optional)

1. Create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN`.
2. Add the bot to a private chat and set `TELEGRAM_CHAT_ID` to that chat's
   ID. New `/security` reports are posted there.
3. New moderation reports go to the same chat, or to
   `TELEGRAM_MODERATION_CHAT_ID` if set. Set it to `OFF` for no moderation
   notices.

### Automatic content checks (optional)

1. Create an API key in the Anthropic Console and set `ANTHROPIC_API_KEY`
   (Production only).
2. Set a monthly spending limit for the key's workspace in the Anthropic
   Console.
3. Redeploy. As an admin, open **Moderation → Settings**, switch the checks
   on, pick the model, choose what is checked and set a daily limit. The
   page lists the supported models with their current prices and an
   estimate per check, and shows this month's usage and cost.

The daily limit is a hard cap: every check is counted before it is sent.
Past it, uploads wait for a moderator and text is not checked until the
next day (UTC).

## Legal pages and footer

`/imprint`, `/privacy` and `/terms` are filled from the `LEGAL_*`
variables, and the footer from `NEXT_PUBLIC_SITE_MAINTAINER` and
`NEXT_PUBLIC_SOURCE_URL`. The defaults name the original maintainer, so
anyone running their own instance must set their own details.

These pages are built at deploy time. **Redeploy after changing any of
these variables.**

## Site password gate (staging)

Set `SITE_PASSWORD_STATUS=ON` and `SITE_PASSWORD` to keep a staging site
private. Visitors enter the password once at `/unlock`. While the gate is
on, the API and `/r` file links are locked too, so turn it off before real
proposals are filed. Changing the password signs everyone out of the gate.
See [`ENVIRONMENT.md`](ENVIRONMENT.md#site-password-gate) for what stays
open.

## Custom RPC (recommended for production)

Public RPC endpoints are rate-limited. For real traffic:

- **Dwellir** is already the fallback. An account at
  <https://www.dwellir.com> gives a higher quota.
- **OnFinality** is an alternative for relay and matrix.
- **Self-hosted**: run an Enjin node and expose its WebSocket.

Set `NEXT_PUBLIC_ENJIN_RELAY_WSS` (and the others as needed) to your
endpoint and redeploy.

## Custom domain

In Vercel:

1. **Settings → Domains**: add your domain.
2. Add the DNS records Vercel shows.
3. Set `NEXT_PUBLIC_APP_URL` to the domain and redeploy.
4. Add the domain to Reown's allowed domains.

## Security headers

Set in `next.config.mjs`: a Content Security Policy, `X-Frame-Options`,
`X-Content-Type-Options` and `Referrer-Policy`. `connect-src` allows any
`https:` and `wss:` host, so a new RPC provider needs no change there.

## Monitoring

No analytics or error tracking is built in. Server errors appear in the
Vercel runtime logs. RPC and signing errors are shown to the user through
`friendlyError()` (`lib/utils/format-error.ts`).

## Rollback

Vercel keeps previous deployments. To roll back, open **Deployments**,
find the last good one and choose **Promote to Production**.

The database does not roll back with it, which is why migrations must stay
backward-compatible for at least one deploy.

## See also

- [`ENVIRONMENT.md`](ENVIRONMENT.md) - every variable
- [`HANDOVER.md`](HANDOVER.md) - secrets inventory, accounts, data export, running moderation
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - Reown setup
- [`../SECURITY.md`](../SECURITY.md) - security model and operator hardening

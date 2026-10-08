# Handover and Operations

The hosted instance at `gov.enjin.cloud` is run and maintained by the
project maintainer on an ongoing basis. This document is the continuity
reference: what the app runs on, which accounts and secrets back it, how to
export its data, and what a new maintainer needs to run moderation.

The safety net for "what if the maintainer stops" is not a credential
handover. The code is licensed under AGPL-3.0-or-later, and every
deployment links to its source in the footer (`NEXT_PUBLIC_SOURCE_URL`).
Anyone, including the Enjin team, can deploy an independent instance from
the source with their own accounts. The whole stack is standard,
self-service infrastructure.

This document does not repeat the step-by-step setup. For that:

- [`DEPLOYMENT.md`](DEPLOYMENT.md) - how to stand the whole thing up.
- [`ENVIRONMENT.md`](ENVIRONMENT.md) - every environment variable.

No secret values live in the repository. The inventory below lists what is
needed and where each value comes from. A new operator provisions their
own; the maintainer's current values are never needed for that, and would
only be shared over a secure channel if ever genuinely necessary.

## 1. Deployment at a glance

| Aspect | Detail |
|---|---|
| Hosting | Vercel (Next.js App Router) |
| Build | `pnpm build` (Node 22, see `.nvmrc`) |
| Dev | `pnpm dev` (`http://localhost:3000`) |
| Tests | `pnpm test` (Vitest: unit tests, the route-level security tests in `lib/__sec__`, and database tests against PGlite), `pnpm test:e2e` (Playwright browser tests in `e2e/`), plus `pnpm typecheck`, `pnpm lint` and `pnpm knip` |
| CI | GitHub Actions (`.github/workflows/ci.yml`) on pushes and pull requests to `main`: the Verify job runs typecheck, lint, knip, tests and build; the Browser tests job runs the Playwright tests against a production build |
| Post-deploy check | **Moderation → Status** (admins): what is set up and what is missing, and a Telegram test message |
| Production domain | `gov.enjin.cloud` (CNAME to Vercel; Cloudflare DNS only, not proxied) |
| Database | Neon Postgres (pooled for requests, unpooled for migrations) |
| Object storage | Cloudflare R2 (S3-compatible), served through the app's `/r` route |
| Rate-limit store | Upstash Redis over REST (optional; without it each instance counts on its own) |
| Content checks | Anthropic API (optional; off until an admin switches them on) |
| Notices | Telegram bot (optional) |

## 2. Secrets and environment inventory

Values are provisioned per service and set in Vercel under **Settings →
Environment Variables**. A change applies from the next deployment. Full
descriptions are in [`ENVIRONMENT.md`](ENVIRONMENT.md).

| Variable | Purpose | Provisioned from | Secret | Needed for |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Canonical origin: file URLs pinned on chain, OpenGraph, canonical URLs and the sitemap, cross-site check | The live domain | No | Any public deployment |
| `NEXT_PUBLIC_DEFAULT_NETWORK` | Network the app opens on (`enjin-relay` for mainnet) | Configuration | No | Optional (default `canary-relay`) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Enjin Wallet and WalletConnect | Reown | No | Mobile wallets |
| `NEXT_PUBLIC_WALLETCONNECT_RELAY_URL` | WalletConnect relay | Configuration | No | Optional (has a default) |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Postgres for requests and for migrations | Neon | Yes | Sign-in and everything off-chain |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 API credentials | Cloudflare | Yes (key and secret) | Proposals, uploads, avatars |
| `R2_BUCKET`, `R2_ENDPOINT`, `R2_PUBLIC_URL` | Bucket name, endpoint, bucket's public URL | Cloudflare | No | Proposals, uploads, avatars |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Shared rate-limit store (or the `UPSTASH_REDIS_REST_*` pair) | Upstash | Yes (token) | Recommended |
| `GOVERNANCE_ADMIN_PUBLIC_KEYS` | Wallets that are always moderation admins | The new owner's wallets | No | Moderation |
| `ANTHROPIC_API_KEY` | Automatic content checks | Anthropic Console | Yes | Optional |
| `TELEGRAM_BOT_TOKEN` | Bot that posts notices | Telegram @BotFather | Yes | Optional |
| `TELEGRAM_CHAT_ID`, `TELEGRAM_MODERATION_CHAT_ID` | Chats for security reports and moderation notices | Telegram | No | Optional |
| `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_ADDRESS`, `LEGAL_CONTACT_EMAIL`, `LEGAL_CONTACT_PHONE`, `LEGAL_VAT_ID` | Operator details for the imprint, privacy policy and terms | The new operator | No | Any public deployment |
| `NEXT_PUBLIC_SITE_MAINTAINER`, `NEXT_PUBLIC_SOURCE_URL` | Publisher name and AGPL source link | The new operator | No | Any public deployment |
| `SITE_PASSWORD_STATUS`, `SITE_PASSWORD` | Password gate for a staging site (`OFF` to disable) | Configuration | Yes (password) | Optional |
| `SUBSCAN_API_KEY` | Call data for very old finalised referenda | Subscan (pro.subscan.io) | Yes | Optional |
| `NEXT_PUBLIC_*_WSS`, `NEXT_PUBLIC_*_SUBSCAN_URL` | RPC endpoints and explorer links | RPC provider | No | Optional (have defaults) |

Every variable is optional or has a default. `lib/env.ts` checks each value
when it loads and fails with the variable's name if one is invalid.
A missing value switches the feature off instead: its routes answer `503`.

One exception: `NEXT_PUBLIC_APP_URL` defaults to localhost, and on
Vercel's production deployment (`VERCEL_ENV=production`, set by Vercel) a
localhost value is refused. Staging drafts, editing proposals and
uploading files and avatars then answer `503`, so no localhost URL is ever
pinned on chain. See [`ENVIRONMENT.md`](ENVIRONMENT.md#app).

The defaults of `LEGAL_*`, `NEXT_PUBLIC_SITE_MAINTAINER` and
`NEXT_PUBLIC_SOURCE_URL` name the original maintainer. A new operator must
set their own, then redeploy: the legal pages are built at deploy time.

## 3. Off-chain data

Two stores back the off-chain layer. The chain is always canonical for
governance; these hold human-readable metadata, the social layer and
moderation.

**Neon Postgres** (schema in
[`DEPLOYMENT.md`](DEPLOYMENT.md#schema-overview), migrations
`scripts/004` to `scripts/014`):

| Surface | Tables |
|---|---|
| Sign-in | `wallet_sessions`, `auth_nonces` |
| Profiles | `users` (handle, display name, bio, avatar, `is_verified`) |
| Comments | `comments`, `comment_reactions` (not used by the current UI) |
| Proposals and drafts | `proposals`, `proposal_attachments` |
| Security reports | `security_disclosures` |
| Moderation | `moderation_roles`, `moderation_state`, `moderation_actions`, `moderation_reports`, `moderation_suspensions` |
| Content checks | `moderation_settings` (settings, health record and once-per-window gates), `moderation_scan_usage` |
| Migration ledger | `_migrations` |

**Cloudflare R2** (layout in [`ENVIRONMENT.md`](ENVIRONMENT.md#storage-cloudflare-r2)):

| Keys | Hold |
|---|---|
| `proposals/{network}/{uuid}/proposal-*.json` | EGOV1 metadata, one file per staged version |
| `proposals/{network}/{uuid}/media/` | Attachments and their thumbnails |
| `proposals/{network}/index/` | Pointers from a referendum index to its proposal |
| `user-avatars/` | Profile images |

### Export and migration

- **Backup from the app:** admins open **Moderation → Status → Backup**
  and create a ZIP with every table (except `wallet_sessions` and
  `auth_nonces`) as JSON, `db/restore.sql`, every proposal JSON file and,
  if ticked, the uploaded files, thumbnails and avatars. `manifest.json`
  lists the app version, the migrations and the sha256 of every file;
  `README.txt` explains the restore. Backups are kept in R2 under
  `backups/`, which `/r` never serves. The newest 5 are kept, one can be
  made every 10 minutes, and a download link is valid for 5 minutes.
  Restore: on an empty database, apply the migrations up to the last one
  `manifest.json` lists (`pnpm db:migrate --until 013` for a backup
  taken before `014`), then
  `psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/restore.sql`,
  then `pnpm db:migrate` for the rest, then copy `bucket/` into the new
  bucket with the same keys (`rclone copy` or `aws s3 sync`). A backup
  taken before `014` still has the `proposer_signature` column, which a
  fully migrated database lacks. A backup must finish within the function's
  5 minutes; for a very large bucket, back up without uploaded files and
  copy the bucket with rclone.
- **Database:** `pg_dump "$DATABASE_URL_UNPOOLED" > backup.sql`, and restore
  with `psql`. Neon also offers branching and point-in-time restore.
- **Personal data:** a backup or dump contains profile data, comments,
  reports and the contacts left in security reports (a dump also session
  IP addresses and user agents). Store it like the production database. To leave sessions and nonces out, add
  `--exclude-table-data=wallet_sessions --exclude-table-data=auth_nonces`.
- **Other Postgres hosts:** the dump restores into any Postgres, but the app
  connects through Neon's HTTP driver (`@neondatabase/serverless` in
  `lib/db/client.ts`). A host other than Neon needs a Neon-compatible HTTP
  proxy or a change to that file. `pnpm db:migrate` uses the same driver.
- **R2:** copy the bucket to any S3-compatible target with `rclone sync` or
  `aws s3 sync` (R2 speaks the S3 API), then update the `R2_*` variables.
  Keep the object keys unchanged: they appear in proposal JSON, in the
  database and in moderation records.
- **No proprietary lock-in:** the full backend can be rebuilt from the
  repository, a Postgres dump and a copy of the bucket.

> Losing the off-chain data does not lose governance state. Each
> proposal's metadata is identified on chain by its `EGOV1:` envelope,
> which pins the hash of the JSON it points to. The envelope can be read
> straight from chain by resolving `referenda.metadataOf` through the
> preimage pallet, or, for older referenda, by decoding the
> `system.remark` call arguments. See
> [`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md).

## 4. Third-party accounts and services

Everything the hosted instance depends on. Because the code is open
source, the main path for a new operator is to provision their own of
each, as the deploy docs describe. Taking over the maintainer's existing
accounts is an alternative, not a requirement.

| Service | Role | How a new operator gets it |
|---|---|---|
| **Vercel** | Hosting, deploys, domain, environment variables | Move the project to the new owner's team, or import the repository into their account and set the variables |
| **Neon** | Postgres database | Transfer the project, or `pg_dump` and restore into their own |
| **Cloudflare R2** | Object storage (JSON, media, avatars) | Move the bucket to the new account, or copy the objects and update `R2_*` |
| **Reown (WalletConnect Cloud)** | Project ID and allowed domains | Transfer the project, or create a new one, set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` and add the allowed domains |
| **Upstash** (recommended) | Shared rate-limit store | New database (for example through the Vercel Marketplace) and `KV_REST_API_*` |
| **Anthropic** (optional) | Automatic content checks | New key in `ANTHROPIC_API_KEY`, with a spending limit on the account |
| **Telegram** (optional) | Security-report and moderation notices | New bot token and chat IDs |
| **RPC provider** (optional) | Dedicated chain endpoints (Dwellir, OnFinality) | Set the `NEXT_PUBLIC_*_WSS` values to the new endpoints |
| **Subscan** (optional) | Call data for very old referenda | New key in `SUBSCAN_API_KEY` |
| **Cloudflare DNS** | `enjin.cloud` zone, `gov` record | Already controlled by Enjin |
| **GitHub** | Source repository | AGPL-3.0-or-later; anyone can fork and run it. The maintainer's repository stays canonical while maintained |

## 5. Running moderation

What a new maintainer needs to run moderation on their own instance.
[`DEPLOYMENT.md`](DEPLOYMENT.md#moderation) has the setup steps.

**The first admin.** Put your wallet address (SS58 on any network, or the
`0x` public key) in `GOVERNANCE_ADMIN_PUBLIC_KEYS`, apply migrations `011`
to `013`, redeploy and sign in with that wallet. **Moderation** then
appears in the navigation. Grant further moderators and admins under
**Moderation → Roles**; those grants live in the database. Admins from the
environment cannot be removed in the app: remove them from the variable
and redeploy.

**The Status tab.** After every deploy, open **Moderation → Status**. It
lists what is set up and what is missing: the database and migrations
`011` to `013`, storage and the public URL, the rate-limit store,
Telegram, the content checks, the legal details and WalletConnect. Each
item is OK, Warning or Problem, with a hint that names the variable to
set; no secret is ever shown. Fix every Problem.
[`DEPLOYMENT.md`](DEPLOYMENT.md#checking-the-deployment) lists the items.

**Automatic content checks.** They need an Anthropic API key in
`ANTHROPIC_API_KEY` and are off until an admin switches them on.

1. Set a spending limit on the Anthropic account before switching them on.
2. In **Moderation → Settings**, pick the model. The page lists the
   supported models with their current prices and an estimate per check.
3. Choose what is checked (images, PDFs, proposal text, comments), how a
   clear violation is handled (reject or hold) and a daily limit.
4. The same page shows today's checks and this month's usage and cost.

The daily limit is a hard cap: every check is counted before it is sent.
Past it, uploads wait for a moderator and text is not checked until the
next day (UTC). Checked content is sent to Anthropic only while the
checks are on; the privacy policy says so.

If the checks fail because of the setup (the key refused, a model that is
no longer available, no credit left, including a "credit balance too low"
answer), uploads go through unchecked, as during an outage. The problem is
recorded, shown under Health in the Status tab and as a banner on the
Settings tab, and reported to the moderators' Telegram chat at most once
a day. Fix the cause, for example top up the account or pick another
model; the next check that gets an answer clears it.
[`DEPLOYMENT.md`](DEPLOYMENT.md#content-check-health) has the details.

**Telegram.** Create a bot with @BotFather and add it to a private chat.
`TELEGRAM_CHAT_ID` receives security reports with their text and contact.
Moderation notices go there too, or to `TELEGRAM_MODERATION_CHAT_ID` if
set (`OFF` turns them off). A report notice only names the kind of item and
links to `/moderation`; it never includes the reporter or the content. The
same chat gets the content-check alerts. **Send test message** in the
Status tab checks the setup, at most once a minute.

**Security reports.** There is no in-app inbox. Reports arrive in Telegram
when it is configured and are always stored in `security_disclosures`.
Read them in the Neon SQL editor:

```sql
SELECT created_at, severity, category, summary, details, contact, status
  FROM security_disclosures
 ORDER BY created_at DESC;
```

Track progress by setting `status` to `triaged`, `resolved` or `dismissed`
by hand.

**Tasks with no UI:**

- Verified badge: `UPDATE users SET is_verified = TRUE, verified_at = NOW() WHERE address = '<address>';`
- Sign every user out: `DELETE FROM wallet_sessions;`

## 6. Maintenance notes

### Content-check models

The supported models and their list prices live in one table,
`SCAN_MODELS` in `lib/moderation/scan-settings.ts`, keyed by the API model
ID. Each entry holds the label and note shown to admins, the input and
output price per million tokens, and the request options the model accepts
(`effort`, `refusalFallback`).

To offer a newer model, for example a new Haiku:

1. Add its entry with its list prices and request options.
2. Set `recommended: true` on it and `false` on the previous default.
   Exactly one entry is recommended; it is the default for new installs
   and is marked in the settings.
3. Set `offered: false` on a model it replaces. Keep that entry in the
   table so past usage keeps its cost.
4. Run `pnpm test` and deploy.

Admins who had picked a model that is no longer offered move to the
recommended one and keep their other settings; the Status tab shows a
Warning until an admin saves the settings again. If Anthropic retires a
model that is still in use, every check fails with a setup problem
("model wasn't found"), which the Status tab, the Settings banner and the
Telegram alert report. When list prices change,
update them in the same table. Costs are computed from the reported token
counts with the prices in this table, so a price change also changes the
cost shown for earlier usage.

### Migrations

A schema change is a new file, `scripts/NNN_name.sql`, numbered after the
last one. Make it idempotent (`IF NOT EXISTS`) and backward-compatible for
at least one deploy. Apply it with `pnpm db:migrate` before deploying the
code that needs it, and add it to the table in
[`DEPLOYMENT.md`](DEPLOYMENT.md#migrations).

A migration that drops something the live release still uses is the
exception: it runs after the deploy. `014_drop_proposer_signature.sql`
drops a column 1.0 still inserts, so upgrading from 1.0 means
`pnpm db:migrate --until 013`, deploying 2.0, and only then
`pnpm db:migrate` (see
[`DEPLOYMENT.md`](DEPLOYMENT.md#migrations-that-wait-for-a-deploy)).
Say so in the file's header and in the changelog's upgrade steps.

### Environment variables

Follow "Adding a new variable" in [`ENVIRONMENT.md`](ENVIRONMENT.md), and
add a row to the inventory above if the variable holds a secret or needs an
account.

## 7. Continuity if maintenance ends

This is a public good for the Enjin ecosystem, funded by the on-chain
treasury rather than by any single company. The maintainer runs the hosted
instance on an ongoing basis, so there is no transfer to perform today and
no shared credentials for anyone to rotate. This section is the
contingency for if the maintainer ever steps back.

**Notice window.** Per the funding proposal, maintenance runs only while
each quarterly referendum is approved, and ends if a quarter's request is
declined roughly three times over about a month. For any wind-down outside
that, a 30-day written notice is the suggested default.

**How continuity works.** Because the code is open source (AGPL-3.0) and
the stack is standard, anyone in the ecosystem can stand up a fully
independent instance:

1. Provision your own accounts (Vercel, Neon, Cloudflare R2, Reown and,
   as needed, Upstash, Anthropic, Telegram and an RPC endpoint) and deploy
   per [`DEPLOYMENT.md`](DEPLOYMENT.md).
2. Set your own operator details (`LEGAL_*`, `NEXT_PUBLIC_SITE_MAINTAINER`,
   `NEXT_PUBLIC_SOURCE_URL`) and your own admin wallets
   (`GOVERNANCE_ADMIN_PUBLIC_KEYS`).
3. Point a domain at it. `gov.enjin.cloud` sits on Enjin's own DNS, so it
   can be repointed to a community-run deployment independently of the
   maintainer.
4. There is nothing to rotate: a new instance uses its own credentials
   from the start.

**Existing links.** EGOV1 records filed through the hosted instance point
at `https://gov.enjin.cloud/r/...`. They keep resolving if that domain is
repointed to a deployment that holds a copy of the R2 bucket. Without the
copy, the links break, but the on-chain hash still identifies the original
content.

**Data.** The hosted instance's off-chain data (profiles, comments,
drafts, the moderation log) can be exported and shared on request
(section 3), but it carries limited value. This is a client. The canonical
governance record, including referenda, votes, locks, treasury and each
proposal's EGOV1 envelope, lives on chain and is unaffected either way. A
fresh instance is fully functional from an empty off-chain store.

**Environment values.** Not needed for any of the above. If a specific
value is ever genuinely required, it is shared only over a secure channel.

## See also

- [`DEPLOYMENT.md`](DEPLOYMENT.md) - provider setup, step by step
- [`ENVIRONMENT.md`](ENVIRONMENT.md) - every environment variable
- [`../SECURITY.md`](../SECURITY.md) - security model and operator hardening
- [`ARCHITECTURE.md`](ARCHITECTURE.md) - how the pieces fit together
- [`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md) - the EGOV1 metadata standard

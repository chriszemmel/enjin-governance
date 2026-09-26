# Deployment

The path of least resistance is **Vercel + Neon + Cloudflare R2 + Reown
(WalletConnect Cloud)**. You can be live in under an hour.

## Vercel

1. Import the repo at <https://vercel.com/new>.
2. Framework preset: **Next.js** (auto-detected).
3. Set env vars under "Settings → Environment Variables":

   | Name | Value | Environment |
   |---|---|---|
   | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | from Reown | Production, Preview, Development |
   | `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` | Production |
   | `NEXT_PUBLIC_APP_URL` | `https://*.vercel.app` (or empty) | Preview |
   | `DATABASE_URL` | Neon pooled connection | Production, Preview |
   | `DATABASE_URL_UNPOOLED` | Neon unpooled connection | Production, Preview |
   | `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | from Cloudflare | Production, Preview |
   | `R2_BUCKET` | `enjin-governance` | Production, Preview |
   | `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | Production, Preview |
   | `R2_PUBLIC_URL` | `https://<bucket>.r2.dev` or custom domain | Production, Preview |
   | `SUBSCAN_API_KEY` | optional, from `pro.subscan.io` | Production |
   | `GOVERNANCE_ADMIN_PUBLIC_KEYS` | your wallet address(es), comma separated | Production, Preview |
   | `LEGAL_OPERATOR_NAME` / `LEGAL_OPERATOR_ADDRESS` / `LEGAL_CONTACT_EMAIL` | optional overrides for imprint + privacy policy | Production, Preview |
   | `LEGAL_CONTACT_PHONE` / `LEGAL_VAT_ID` | optional, imprint | Production, Preview |
   | `NEXT_PUBLIC_SITE_MAINTAINER` / `NEXT_PUBLIC_SOURCE_URL` | footer (defaults set) | Production, Preview |
   | `ANTHROPIC_API_KEY` | optional, automatic content checks | Production |

4. Deploy.

After the first deploy, **update Reown** to add your Vercel domain to
the project's allowed origins, otherwise the WalletConnect modal will
refuse to load metadata.

## Neon

1. Create a project at <https://neon.tech>.
2. Copy both the **pooled** (`-pooler.neon.tech`) and **unpooled**
   connection strings - the app uses the pooled one for requests, the
   unpooled one for migrations.
3. Apply the migrations in order:

   ```bash
   psql "$DATABASE_URL_UNPOOLED" -f scripts/004_proposals_comments_profiles.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/005_user_verification.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/006_proposal_edits.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/007_proposal_withdrawal.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/008_auth_nonces.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/009_users_per_network_handle.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/010_security_disclosures.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/011_moderation.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/012_moderation_settings.sql
   ```

   (or `pnpm db:migrate`, which runs `scripts/run-migrations.mjs`.)

4. Set `DATABASE_URL` + `DATABASE_URL_UNPOOLED` in Vercel.

The app degrades gracefully when `DATABASE_URL` is unset: sign-in
returns 503, the auth / profile / comments / drafts surfaces show
"unavailable", and the rest of the app keeps working off the RPC.

### Schema overview

The migrations create:

| Table | Purpose |
|---|---|
| `users` | One row per SS58 address. Profile fields (display name, handle, bio, avatar URL, `is_verified`) live here. |
| `wallet_sessions` | httpOnly session cookies. Rotating; one row per signed-in session. |
| `proposals` | Off-chain mirror of every proposal filed through the wizard. `status ∈ ('draft', 'submitted', 'on_chain', 'failed', 'cancelled')`. The R2 JSON is canonical; this row is a fast index. |
| `proposal_attachments` | Image / PDF attachments referenced by a proposal. R2 objects. |
| `comments` | Threaded comments per referendum. Soft-deletable. |
| `comment_reactions` | Up/down votes on comments. |
| `auth_nonces` | Short-lived SIWE sign-in nonces, consumed atomically on verify (added in `008`). |
| `security_disclosures` | Inbound vulnerability reports from the public `/security` form (added in `010`). No account required; IP-rate-limited and honeypot-guarded against bots, raw IP never stored. |
| `moderation_roles`, `moderation_state`, `moderation_actions`, `moderation_reports`, `moderation_suspensions` | Moderator/admin roles by public key, per-item state (visible / blurred / hidden / removed), the public action log, reports and posting pauses (added in `011`). |
| `moderation_settings`, `moderation_scan_usage` | Admin settings for the automatic content checks and a per-day, per-model usage counter for the daily limit and cost display (added in `012`). |

The `updated_at` trigger function ships with the same migration.
There's no migration framework wired in by design - flat, forward-only
SQL files are easier to audit than a Prisma/Drizzle pipeline. Revisit
if migration count exceeds ~20.

## Cloudflare R2

1. Create an R2 bucket at <https://dash.cloudflare.com> (default name
   in env is `enjin-governance`).
2. Create an R2 API token with read + write on the bucket.
3. Public access to the bucket is not needed: the app serves every file
   through its own `/r` route (see below). Keep it off unless older
   proposals depend on it (see "Hidden files and the bucket's own URL").
4. Paste the credentials into Vercel. `R2_PUBLIC_URL` is still required
   by the config check; set it to the bucket's public URL if it has one,
   otherwise to any placeholder `https://` URL.

CORS isn't required - every R2 write goes through our API routes
server-side.

### Public reads go through the app, not the bucket URL

Public reads (proposal JSON, media, avatars) are served from the app's
own origin via the `/r/<key>` route (`app/r/[...key]/route.ts`), which
streams the object from R2 with the right content type, cache window, and
CORS. The URLs we hand out - including the EGOV1 `u` pointer pinned on
chain - are therefore `https://<app>/r/...`, built from
`NEXT_PUBLIC_APP_URL`, not the raw bucket URL.

This is deliberate: the on-chain pointer stays on a durable, official
domain, decoupled from where R2 actually lives (move the bucket later and
the link still resolves), and off the rate-limited `r2.dev` URL.
`R2_PUBLIC_URL` stays set but is now an internal fallback for when no app
origin is configured. Because the EGOV1 `u` is baked in at submit time,
make sure `NEXT_PUBLIC_APP_URL` is the canonical production domain before
any mainnet proposal is filed.

### Hidden files and the bucket's own URL

Moderation (blurring, hiding, holds by the automatic check) is enforced
by `/r`. A file stays reachable through the bucket's own public URL
(`r2.dev` or a custom domain) if one is enabled, because Cloudflare
serves it directly. So:

- If no proposal links to the bucket URL, turn public access off.
- Proposals filed before 28 June 2026 pinned the bucket URL in their
  EGOV1 record, so turning it off breaks their verification. In that
  case keep a custom domain (not `r2.dev`) and add a Cloudflare WAF rule
  on it that blocks `/proposals/*/media/*`, so only the JSON stays
  public there. `/r` keeps serving media with moderation applied.
- Legal takedowns use "Delete file", which removes the object itself and
  works either way.

## Reown (WalletConnect Cloud)

1. Create a project at <https://cloud.reown.com>.
2. Name it "Enjin Governance" (or whatever).
3. App URL: your Vercel domain.
4. Copy the 32-char project ID into Vercel env vars.
5. Under "Allowed Domains", add:
   - your production domain,
   - `*.vercel.app` for preview deploys,
   - `localhost:3000` for local dev.

## Custom RPC (optional, recommended for production)

Public RPC endpoints rate-limit. For real traffic:

- **Dwellir** - already wired as fallback. Sign up at <https://www.dwellir.com>
  for a higher quota.
- **OnFinality** - alternative provider. Both relay and matrix supported.
- **Self-hosted** - run an Enjin node and proxy WS.

Set `NEXT_PUBLIC_ENJIN_RELAY_WSS` to your dedicated endpoint.

## Custom domain

In Vercel:

1. "Settings → Domains" → add your domain.
2. Add DNS records as instructed.
3. Update `NEXT_PUBLIC_APP_URL` to match.
4. Update Reown allowed origins.

## CSP and security headers

Defined in `next.config.mjs`. If you add new external services (a new
RPC provider, an analytics tool, etc.), update `connect-src`
accordingly.

## Monitoring

`@vercel/analytics` is in the dependency list - wire it into
`app/layout.tsx` when ready (it's a 2-line addition).

For chain-level errors (RPC connect failures, signing errors), the app
already surfaces them to the user via toast + `friendlyError()`. For
long-term tracking, an opt-in Sentry integration is the right move -
not in v1.

## Rollback

Vercel preserves previous deploys. To roll back:

1. "Deployments" tab → find the last good deploy → "Promote to Production".

Migrations are forward-only - Neon doesn't auto-revert. Keep
migrations backward-compatible (add columns, don't drop) for at least
one deploy cycle.

## See also

- [`ENVIRONMENT.md`](ENVIRONMENT.md) - every env var
- [`HANDOVER.md`](HANDOVER.md) - secrets inventory, off-chain data export, accounts to transfer, sunset plan
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - Reown setup
